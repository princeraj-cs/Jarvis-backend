const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const ytsr = require('ytsr');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- System Telemetry ---
app.get('/api/system', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsage = (usedMem / totalMem) * 100;
  
  // CPU usage is tricky in Node without libraries, so we use a loadavg approximation
  const load = os.loadavg();
  const cpuUsage = (load[0] * 100 / os.cpus().length).toFixed(1);

  res.json({
    cpu: Math.min(100, parseFloat(cpuUsage)),
    memory: parseFloat(memUsage.toFixed(1)),
    uptime: os.uptime(),
    platform: os.platform(),
    hostname: os.hostname()
  });
});

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
    try {
      if (!process.env.NEWS_API_KEY) return { error: 'News API key missing' };
      const url = args.topic 
        ? `https://newsapi.org/v2/everything?q=${encodeURIComponent(args.topic)}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${process.env.NEWS_API_KEY}`
        : `https://newsapi.org/v2/top-headlines?pageSize=5&language=en&apiKey=${process.env.NEWS_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      return data.status === 'ok' ? { articles: data.articles.map(a => ({ title: a.title, source: a.source.name })) } : { error: data.message || 'News fetch failed' };
    } catch (e) {
      console.error('[TOOL ERROR] News:', e.message);
      return { error: 'News service currently unavailable' };
    }
  },

  get_weather: async (args) => {
    try {
      if (!process.env.WEATHER_API_KEY) return { error: 'Weather API key missing' };
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&appid=${process.env.WEATHER_API_KEY}&units=metric`;
      const res = await fetch(url);
      const data = await res.json();
      return data.cod === 200 ? { temp: data.main.temp, condition: data.weather[0].description, city: data.name } : { error: data.message || 'City not found' };
    } catch (e) {
      console.error('[TOOL ERROR] Weather:', e.message);
      return { error: 'Weather service currently unavailable' };
    }
  },

  open_website: (args) => new Promise(resolve => {
    try {
      let url = args.url.trim();
      if (!url.includes('.') && !url.includes('://')) url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      else if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      exec(`start "" "${url}"`, (err) => resolve(err ? { error: err.message } : { status: 'success', opened: url }));
    } catch (e) {
      resolve({ error: 'Failed to open website' });
    }
  }),

  open_local_app: (args) => new Promise(resolve => {
    try {
      const appName = args.appName.toLowerCase().trim();
      const appMap = { 
        'vs code': 'code', 
        'vscode': 'code',
        'visual studio code': 'code',
        'chrome': 'chrome', 
        'browser': 'chrome',
        'google chrome': 'chrome',
        'notepad': 'notepad', 
        'calculator': 'calc', 
        'calc': 'calc',
        'edge': 'msedge',
        'microsoft edge': 'msedge',
        'terminal': 'wt',
        'cmd': 'cmd',
        'powershell': 'powershell'
      };
      const command = appMap[appName] || appName;
      console.log(`[SYSTEM] Launching: ${command} (Original: ${args.appName})`);
      
      exec(`start "" ${command}`, (err) => {
        if (!err) return resolve({ status: 'success', app: args.appName });
        // Fallback: search system path or common locations
        exec(`where ${command}`, (wErr, stdout) => {
          const path = !wErr && stdout ? stdout.split('\r\n')[0].trim() : null;
          if (path) {
            exec(`start "" "${path}"`, (sErr) => resolve(sErr ? { error: `Failed to launch ${args.appName}` } : { status: 'success' }));
          } else {
            resolve({ error: `App ${args.appName} not found` });
          }
        });
      });
    } catch (e) {
      resolve({ error: 'Failed to launch application' });
    }
  }),

  media_control: async (args) => {
    try {
      const { platform, action, query } = args;
      let url = '';
      const encodedQuery = encodeURIComponent(query);
      if (platform === 'youtube') {
        if (action === 'play') {
          try {
            console.log(`[YOUTUBE] Searching for: ${query}`);
            const results = await ytsr(query, { limit: 15 });
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
    } catch (e) {
      return { error: 'Media control failed' };
    }
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
function correctPhonetics(text) {
  if (!text) return '';
  let corrected = text.toLowerCase();
  
  // Specific JARVIS mappings
  const MAP = {
    'guitar': 'github',
    'get hub': 'github',
    'zervas': 'jarvis',
    'service': 'jarvis',
    'jarvis': 'jarvis',
    'open you to': 'open youtube',
    'play star boy': 'play starboy',
    'open vs': 'open vscode',
    'vs code': 'vscode',
    'visual studio code': 'vscode',
    'open chrome': 'open chrome',
    'search on google': 'search google',
    'tell me the weather': 'get weather',
    'launch': 'open',
    'start': 'open'
  };

  for (const [wrong, right] of Object.entries(MAP)) {
    // Use word boundaries for precise matching
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
    corrected = corrected.replace(regex, right);
  }
  
  return corrected;
}

// --- Groq AI Proxy ---
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model, stream: clientRequestedStream } = req.body;
    
    // Correct the latest user message
    const userMsg = messages[messages.length - 1];
    if (userMsg?.role === 'user') {
      userMsg.content = correctPhonetics(userMsg.content);
      saveMessage('user', userMsg.content);
    }

    // Function to stream from Groq to our client
    async function streamGroqResponse(groqMessages, isToolPass = false) {
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          model, 
          messages: groqMessages, 
          tools: isToolPass ? undefined : tools, 
          tool_choice: isToolPass ? undefined : 'auto',
          stream: true 
        }),
      });

      if (!groqResponse.ok) {
        const errorData = await groqResponse.json();
        throw new Error(errorData.error?.message || 'Groq API Error');
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let fullText = '';
      let toolCalls = [];
      let currentToolCall = null;

      for await (const chunk of groqResponse.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue;
          if (line.trim() === 'data: [DONE]') {
            if (toolCalls.length > 0) return { toolCalls };
            res.write('data: [DONE]\n\n');
            saveMessage('assistant', fullText);
            res.end(); // Ensure connection is closed
            return { fullText };
          }

          try {
            const data = JSON.parse(line.replace('data: ', ''));
            const delta = data.choices[0].delta;

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id, function: { name: '', arguments: '' } };
                  currentToolCall = toolCalls[tc.index];
                }
                if (tc.function?.name) currentToolCall.function.name += tc.function.name;
                if (tc.function?.arguments) currentToolCall.function.arguments += tc.function.arguments;
              }
            } else if (delta.content) {
              fullText += delta.content;
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta.content } }] })}\n\n`);
            }
          } catch (e) {
            // Partial JSON or other error, ignore
          }
        }
      }
      res.end(); // Always end the response
      return { fullText, toolCalls };
    }

    // First Pass
    let firstPassResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false }),
    });

    if (!firstPassResponse.ok) {
      const errorData = await firstPassResponse.json().catch(() => ({}));
      const status = firstPassResponse.status;
      console.error(`[GROQ ERROR] Status: ${status}`, errorData);
      
      if (status === 401) return res.status(401).json({ error: 'Invalid Groq API Key. Please check your .env file.' });
      if (status === 429) return res.status(429).json({ error: 'Rate limit reached. Please wait a moment.' });
      return res.status(status).json({ error: errorData.error?.message || 'AI service unavailable' });
    }

    let data = await firstPassResponse.json();
    let message = data.choices?.[0]?.message;

    // Hallucination Fallback (Non-streaming for tool detection is safer)
    if (!message || (message.content && message.content.includes('function='))) {
      const content = message?.content || (data.error?.failed_generation || '');
      if (content.includes('function=') || content.includes('<function')) {
        // Match <function=name>{json} OR (function=name>key=value OR name({json})
        const match = content.match(/<function=([\w_]+)[^>]*>({[\s\S]*?})/i) || 
                      content.match(/\(function=([\w_]+)>([\s\S]*?)(?:\)|$)/i) ||
                      content.match(/([\w_]+)\(({[\s\S]*?})\)/); 

        if (match) {
          let args = match[2].trim();
          // If args look like key=value, convert to JSON
          if (!args.startsWith('{') && args.includes('=')) {
            const obj = {};
            args.split(',').forEach(pair => {
              const [k, v] = pair.split('=');
              if (k && v) obj[k.trim()] = v.trim();
            });
            args = JSON.stringify(obj);
          }
          message = { role: 'assistant', tool_calls: [{ id: `m_${Date.now()}`, function: { name: match[1], arguments: args } }] };
        }
      }
    }

    if (!message) {
      return res.status(500).json({ error: 'AI returned an empty response' });
    }

    if (message.tool_calls?.length) {
      const toolMessages = [...messages, message];
      for (const toolCall of message.tool_calls) {
        const result = await handleToolCall(toolCall);
        toolMessages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: JSON.stringify(result) });
      }

      toolMessages.push({ 
        role: 'system', 
        content: 'Task done. Now tell master naturally about it. NO JSON, NO tags. Just clean speech.' 
      });

      await streamGroqResponse(toolMessages, true);
    } else {
      // Direct response - we already have it from the first pass (non-streaming for tool detection)
      // But to provide a "streaming" feel, we can just send it back as one or more SSE chunks
      let finalContent = message.content || "I'm sorry, I couldn't process that.";
      finalContent = finalContent
        .replace(/<function.*?>.*?<\/function>/gi, '')
        .replace(/<tool_call.*?>.*?<\/tool_call>/gi, '')
        .replace(/\(function=.*?>.*?(?:\)|$)/gi, '') // Strip (function=get_news>topic=world)
        .replace(/\[function=.*?\]/gi, '') // Strip [function=...]
        .trim();

      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      saveMessage('assistant', finalContent);
      res.end();
    }

  } catch (error) {
    console.error('Proxy Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server Error' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      res.end();
    }
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
