const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const ytsr = require('ytsr');
const { exec } = require('child_process');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Database Setup ---
const db = new sqlite3.Database(path.join(__dirname, 'jarvis.db'), (err) => {
  if (err) console.error('DB Connection Error:', err);
  else {
    console.log('Connected to JARVIS SQLite Database.');
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

app.use(cors());
app.use(express.json());

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    groq: !!process.env.GROQ_API_KEY,
    news: !!process.env.NEWS_API_KEY,
    weather: !!process.env.WEATHER_API_KEY
  });
});

// --- System Tools ---
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Fetch the latest news headlines.',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Fetch current weather for a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_website',
      description: 'Open a specific website homepage (e.g., YouTube, Facebook, Twitter) or a search query.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Domain name or search query' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_local_app',
      description: 'Open a local Windows application.',
      parameters: {
        type: 'object',
        properties: { appName: { type: 'string' } },
        required: ['appName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'media_control',
      description: 'Used ONLY for playing specific songs or searching for specific videos. Use open_website for general navigation.',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['youtube', 'spotify', 'generic'] },
          action: { type: 'string', enum: ['play', 'search', 'open_channel'] },
          query: { type: 'string', description: 'Song name, video title, or channel name' }
        },
        required: ['platform', 'action', 'query']
      }
    }
  }
];

const toolHandlers = {
  get_news: async (args) => {
    const url = args.topic 
      ? `https://newsapi.org/v2/everything?q=${encodeURIComponent(args.topic)}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${process.env.NEWS_API_KEY}`
      : `https://newsapi.org/v2/top-headlines?pageSize=5&language=en&apiKey=${process.env.NEWS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.status === 'ok' ? { articles: data.articles.map(a => ({ title: a.title, source: a.source.name })) } : { error: 'News fetch failed' };
  },

  get_weather: async (args) => {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&appid=${process.env.WEATHER_API_KEY}&units=metric`;
    const res = await fetch(url);
    const data = await res.json();
    return data.cod === 200 ? { temp: data.main.temp, condition: data.weather[0].description, city: data.name } : { error: 'City not found' };
  },

  open_website: (args) => new Promise(resolve => {
    let url = args.url.trim();
    if (!url.includes('.') && !url.includes('://')) url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    else if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    exec(`start "" "${url}"`, (err) => resolve(err ? { error: err.message } : { status: 'success', opened: url }));
  }),

  open_local_app: (args) => new Promise(resolve => {
    const appMap = { 'vs code': 'code', 'chrome': 'chrome', 'notepad': 'notepad', 'calculator': 'calc', 'edge': 'msedge' };
    const command = appMap[args.appName.toLowerCase()] || args.appName;
    exec(`start "" ${command}`, (err) => {
      if (!err) return resolve({ status: 'success', app: args.appName });
      // Fallback: search system path or common locations
      exec(`where ${command}`, (wErr, stdout) => {
        const path = !wErr && stdout ? stdout.split('\r\n')[0].trim() : null;
        if (path) exec(`start "" "${path}"`, (sErr) => resolve(sErr ? { error: `Failed to launch ${args.appName}` } : { status: 'success' }));
        else resolve({ error: `App ${args.appName} not found` });
      });
    });
  }),

  media_control: async (args) => {
    const { platform, action, query } = args;
    let url = '';
    const encodedQuery = encodeURIComponent(query);
    if (platform === 'youtube') {
      if (action === 'play') {
        try {
          console.log(`[YOUTUBE] Searching for: ${query}`);
          const results = await ytsr(query, { limit: 15 });
          // Filter for videos specifically
          const video = results.items.find(i => i.type === 'video' && !i.isLive && !i.isUpcoming);
          url = video ? video.url : `https://www.youtube.com/results?search_query=${encodedQuery}`;
        } catch (e) { 
          console.error('[YOUTUBE ERROR]', e.message);
          url = `https://www.youtube.com/results?search_query=${encodedQuery}`; 
        }
      } else if (action === 'open_channel') {
        url = `https://www.youtube.com/results?search_query=${encodedQuery}&sp=EgIQAg%253D%253D`;
      } else {
        url = `https://www.youtube.com/results?search_query=${encodedQuery}`;
      }
    } else if (platform === 'spotify') {
      url = `https://open.spotify.com/search/${encodedQuery}`;
    } else {
      url = `https://www.google.com/search?q=play+${encodedQuery}`;
    }

    return new Promise(resolve => {
      exec(`start "" "${url}"`, (err) => resolve(err ? { error: err.message } : { status: 'success', platform, action, url }));
    });
  }
};

async function handleToolCall(toolCall) {
  const { name, arguments: argsStr } = toolCall.function;
  try {
    const args = JSON.parse(argsStr);
    const handler = toolHandlers[name];
    console.log(`[EXEC] Tool: ${name}`, args);
    const result = handler ? await handler(args) : 
                   (name === 'youtube_control' ? await toolHandlers.media_control({ ...args, platform: 'youtube' }) : { error: `Unknown tool: ${name}` });
    console.log(`[RESULT] Tool: ${name}`, result);
    return result;
  } catch (e) {
    return { error: 'Invalid tool arguments' };
  }
}

// --- Database Helpers ---
function saveMessage(role, content) {
  db.run('INSERT INTO messages (role, content) VALUES (?, ?)', [role, content], (err) => {
    if (err) console.error('Error saving message:', err);
  });
}

// --- Fetch History Endpoint ---
app.get('/api/history', (req, res) => {
  db.all('SELECT role, content FROM messages ORDER BY timestamp DESC LIMIT 20', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.reverse()); // Return in chronological order
  });
});

// --- Phonetic Correction Layer ---
const VOCAB_MAP = {
  'guitar': 'github',
  'get hub': 'github',
  'zervas': 'jarvis',
  'service': 'jarvis',
  'open you to': 'open youtube',
  'play star boy': 'play starboy',
  'open vs': 'open vscode'
};

function correctPhonetics(text) {
  let corrected = text.toLowerCase();
  for (const [wrong, right] of Object.entries(VOCAB_MAP)) {
    corrected = corrected.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), right);
  }
  return corrected;
}

// --- Groq AI Proxy ---
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model, stream } = req.body;
    
    // Correct the latest user message
    const userMsg = messages[messages.length - 1];
    if (userMsg?.role === 'user') {
      userMsg.content = correctPhonetics(userMsg.content);
      saveMessage('user', userMsg.content);
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
    });

    let data = await response.json();
    
    // Hallucination Fallback
    const content = data.choices?.[0]?.message?.content || '';
    const errorFg = data.error?.failed_generation || '';
    
    if (content.includes('<function') || errorFg.includes('<function') || data.error?.code === 'tool_use_failed') {
      const fg = errorFg || content;
      const match = fg.match(/<function=([\w_]+)[^>]*>({[\s\S]*?})(?:<\/function>|<function>|\/function|)?/i) || 
                    fg.match(/([\w_]+)\(({[\s\S]*?})\)/); 
      
      if (match) {
        const toolName = match[1];
        let toolArgs = match[2];
        try {
          const lastBrace = toolArgs.lastIndexOf('}');
          if (lastBrace !== -1) toolArgs = toolArgs.substring(0, lastBrace + 1);
          JSON.parse(toolArgs);
          data = { choices: [{ message: { role: 'assistant', tool_calls: [{ id: `m_${Date.now()}`, function: { name: toolName, arguments: toolArgs } }] } }] };
          console.log(`[MANUAL PARSE] ${toolName}`);
        } catch {}
      }
    }

    if (!data.choices?.length) {
      console.error('Groq Error:', data);
      return res.status(500).json({ error: 'AI Error' });
    }

    const message = data.choices[0].message;

    if (message.tool_calls?.length) {
      const toolMessages = [...messages, message];
      for (const toolCall of message.tool_calls) {
        const result = await handleToolCall(toolCall);
        toolMessages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: JSON.stringify(result) });
      }

      // Inject a strictly conversational reminder to prevent JSON hallucinations in the second pass
      toolMessages.push({ 
        role: 'system', 
        content: 'IMPORTANT: Task already executed. NO JSON, NO code, NO <tags>. Just talk to master naturally. If you output any { or <, master will be angry. Just say: "As you wish master, I have [action]..." or similar.' 
      });

      const finalResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages: toolMessages, stream }),
      });

      if (!stream) {
        const finalData = await finalResponse.json();
        const reply = finalData.choices?.[0]?.message?.content || "";
        saveMessage('assistant', reply);
        return res.json(finalData);
      }

      res.setHeader('Content-Type', 'text/event-stream');
      let fullText = '';
      finalResponse.body.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const raw = line.replace('data: ', '').trim();
          if (raw === '[DONE]') continue;
          try {
            const json = JSON.parse(raw);
            fullText += json.choices?.[0]?.delta?.content || '';
          } catch {}
        }
        res.write(chunk);
      });
      finalResponse.body.on('end', () => {
        if (fullText) saveMessage('assistant', fullText);
        res.end();
      });
      return;
    }

    // No tool call
    let finalContent = message.content || "I'm sorry, I couldn't process that.";
    // Aggressive cleaning of tool-related hallucinations
    finalContent = finalContent
      .replace(/<function.*?>.*?<\/function>/gi, '')
      .replace(/<tool_call.*?>.*?<\/tool_call>/gi, '')
      .replace(/{\s*"platform":[\s\S]*?}/gi, '')
      .replace(/{\s*"action":[\s\S]*?}/gi, '')
      .trim();

    if (!stream) {
      saveMessage('assistant', finalContent);
      return res.json({ ...data, choices: [{ ...data.choices[0], message: { ...data.choices[0].message, content: finalContent } }] });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    saveMessage('assistant', finalContent);

  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: 'Server Error' });
  }
});

// --- API Proxies (Used by Dashboard Widgets) ---
app.get('/api/news', async (req, res) => {
  const result = await toolHandlers.get_news(req.query);
  res.json(result);
});

app.get('/api/weather', async (req, res) => {
  const result = await toolHandlers.get_weather(req.query);
  res.json(result);
});

app.listen(PORT, () => console.log(`J.A.R.V.I.S on port ${PORT}`));
