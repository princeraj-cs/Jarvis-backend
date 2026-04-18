const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();

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
      description: 'Fetch the latest news headlines. Can be filtered by topic (e.g. "tech", "sports").',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The news topic (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Fetch current weather for a specific city.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'The name of the city' }
        },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_website',
      description: 'Open a specific website in the browser. Use this for YouTube, Instagram, Facebook, or any URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open (e.g. youtube.com, google.com)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_local_app',
      description: 'Open a local Windows application. Use this for Notepad, VS Code, Calculator, Chrome, Edge, etc.',
      parameters: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'The common name of the application' }
        },
        required: ['appName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'close_local_app',
      description: 'Close a running Windows application.',
      parameters: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'The process name (e.g. "notepad.exe", "msedge.exe")' }
        },
        required: ['appName']
      }
    }
  }
];

async function handleToolCall(toolCall) {
  const { name, arguments: argsString } = toolCall.function;
  let args;
  try {
    args = JSON.parse(argsString);
  } catch (e) {
    console.error(`Failed to parse tool arguments: ${argsString}`);
    return { error: 'Invalid JSON in tool arguments' };
  }

  console.log(`Executing tool: ${name}`, args);

  switch (name) {
    case 'get_news':
      return new Promise(async (resolve) => {
        try {
          const topic = args.topic;
          const url = topic 
            ? `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${process.env.NEWS_API_KEY}`
            : `https://newsapi.org/v2/top-headlines?pageSize=5&language=en&apiKey=${process.env.NEWS_API_KEY}`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.status !== 'ok') resolve({ error: 'Failed to fetch news' });
          else resolve({ status: 'success', articles: data.articles.map(a => ({ title: a.title, source: a.source.name })) });
        } catch (e) {
          resolve({ error: e.message });
        }
      });

    case 'get_weather':
      return new Promise(async (resolve) => {
        try {
          const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&appid=${process.env.WEATHER_API_KEY}&units=metric`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.cod !== 200) resolve({ error: 'City not found' });
          else resolve({ status: 'success', data: { temp: data.main.temp, condition: data.weather[0].description, city: data.name } });
        } catch (e) {
          resolve({ error: e.message });
        }
      });

    case 'open_website':
      return new Promise((resolve) => {
        let url = args.url.trim();
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        exec(`start ${url}`, (err) => {
          if (err) resolve({ error: `Failed to open website: ${err.message}` });
          else resolve({ status: 'success', message: `Opened ${url}` });
        });
      });

    case 'open_local_app':
      return new Promise((resolve) => {
        let command = args.appName.toLowerCase();
        
        // Common App Mappings
        const appMap = {
          'vs code': 'code',
          'visual studio code': 'code',
          'microsoft edge': 'msedge',
          'edge': 'msedge',
          'chrome': 'chrome',
          'google chrome': 'chrome',
          'notepad': 'notepad',
          'calculator': 'calc',
          'calc': 'calc',
          'steam': 'steam',
          'vlc': 'vlc',
          'spotify': 'spotify',
          'discord': 'discord',
          'slack': 'slack',
          'zoom': 'zoom',
          'brave': 'brave'
        };

        if (appMap[command]) {
          command = appMap[command];
        }

        // Try 'start' first
        exec(`start ${command}`, (err) => {
          if (err) {
            // Check if it's in PATH via 'where'
            exec(`where ${command}`, (whereErr, stdout) => {
              if (!whereErr && stdout) {
                const exePath = stdout.split('\r\n')[0].trim();
                exec(`start "" "${exePath}"`, (startErr) => {
                  if (startErr) resolve({ error: `Could not launch ${command} even after finding it.` });
                  else resolve({ status: 'success', message: `Launched ${command} from system path.` });
                });
              } else {
                // Fallback: Check common installation paths
                const fallbacks = {
                  'steam': '"C:\\Program Files (x86)\\Steam\\steam.exe"',
                  'code': '"C:\\Users\\' + (process.env.USERNAME || '') + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"',
                  'msedge': '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
                  'chrome': '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
                  'brave': '"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"'
                };

                if (fallbacks[command]) {
                  exec(`start "" ${fallbacks[command]}`, (fallbackErr) => {
                    if (fallbackErr) resolve({ error: `Could not find ${args.appName} in standard locations.` });
                    else resolve({ status: 'success', message: `Launched ${args.appName} via fallback path.` });
                  });
                } else {
                  resolve({ error: `Failed to open app ${args.appName}.` });
                }
              }
            });
          } else {
            resolve({ status: 'success', message: `Launched ${args.appName}` });
          }
        });
      });

    case 'close_local_app':
      return new Promise((resolve) => {
        let processName = args.appName.toLowerCase();
        if (!processName.endsWith('.exe')) processName += '.exe';
        exec(`taskkill /IM ${processName} /F`, (err) => {
          if (err) resolve({ error: `Failed to close ${args.appName}. Maybe it's not running?` });
          else resolve({ status: 'success', message: `Closed ${args.appName}` });
        });
      });

    default:
      return { error: 'Unknown tool' };
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

// --- Groq AI Proxy ---
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model, stream } = req.body;
    
    // Save User Message (last one in array)
    const userMsg = messages[messages.length - 1];
    if (userMsg && userMsg.role === 'user') {
      saveMessage('user', userMsg.content);
    }

    console.log(`Received request for model: ${model}`);
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: tools,
        tool_choice: 'auto',
      }),
    });

    let data = await response.json();
    
    // Fallback for Llama 3 malformed tool calls
    if (data.error && data.error.code === 'tool_use_failed' && data.error.failed_generation) {
      console.log('Attempting manual parse of failed generation...');
      const fg = data.error.failed_generation;
      const match = fg.match(/<function=([\w_]+).*?>?({.*?})<\/function>/i);
      
      if (match) {
        const toolName = match[1];
        const toolArgs = match[2];
        data = {
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'manual_' + Date.now(),
                function: { name: toolName, arguments: toolArgs }
              }]
            }
          }]
        };
      } else {
        return res.status(400).json(data);
      }
    }

    if (!data.choices || data.choices.length === 0) {
      console.error('Groq API Error:', data);
      return res.status(500).json({ error: 'Invalid response from AI' });
    }

    const message = data.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolMessages = [...messages, message];
      
      for (const toolCall of message.tool_calls) {
        const toolResult = await handleToolCall(toolCall);
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(toolResult),
        });
      }

      const finalResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: toolMessages,
          stream: stream
        }),
      });

      if (!stream) {
        const finalData = await finalResponse.json();
        saveMessage('assistant', finalData.choices[0].message.content);
        return res.json(finalData);
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let fullText = '';
      finalResponse.body.on('data', (chunk) => {
        const str = chunk.toString();
        // Extract content from SSE data
        const lines = str.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const rawData = line.replace('data: ', '').trim();
          if (rawData === '[DONE]') continue;
          try {
            const json = JSON.parse(rawData);
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

    // No tool call, just return or stream the original response content
    let content = message.content || "I'm sorry, I couldn't process that.";
    
    // Safety check: Clean out any rogue tool tags the model might have hallucinated in the text
    content = content.replace(/<function.*?>.*?<\/function>/gi, '');
    content = content.replace(/<tool_call.*?>.*?<\/tool_call>/gi, '');

    if (!stream) {
      saveMessage('assistant', content);
      return res.json({ ...data, choices: [{ ...data.choices[0], message: { ...data.choices[0].message, content } }] });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({
      choices: [{ delta: { content: content } }]
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    saveMessage('assistant', content);

  } catch (error) {
    console.error('Groq Proxy Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- News API Proxy ---
app.get('/api/news', async (req, res) => {
  try {
    const { topic } = req.query;
    const url = topic 
      ? `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&pageSize=5&sortBy=publishedAt&language=en&apiKey=${process.env.NEWS_API_KEY}`
      : `https://newsapi.org/v2/top-headlines?pageSize=5&language=en&apiKey=${process.env.NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Weather API Proxy ---
app.get('/api/weather', async (req, res) => {
  try {
    const { city } = req.query;
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${process.env.WEATHER_API_KEY}&units=metric`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`J.A.R.V.I.S Backend running on http://localhost:${PORT}`);
});
