# 🤖 J.A.R.V.I.S Backend (Node.js + Express)

This backend powers your J.A.R.V.I.S assistant with:

- 💬 AI chat via Groq
- 📰 Live news via NewsAPI
- 🌤️ Weather via OpenWeather
- 🗂️ Local chat history storage via SQLite

---

## 1) 🔑 APIs Used and Required Keys

You need API keys for the following external services:

1. Groq API

- Environment variable: `GROQ_API_KEY`
- Used in: `/api/chat`
- Base URL used by backend: `https://api.groq.com/openai/v1/chat/completions`

2. NewsAPI

- Environment variable: `NEWS_API_KEY`
- Used in: `/api/news` and tool call `get_news`
- Base URL used by backend: `https://newsapi.org/v2`

3. OpenWeather API

- Environment variable: `WEATHER_API_KEY`
- Used in: `/api/weather` and tool call `get_weather`
- Base URL used by backend: `https://api.openweathermap.org/data/2.5/weather`

---

## 2) 🧭 How to Get Each API Key

### A) 🤖 Groq API Key

1. Open: https://console.groq.com/
2. Sign up or log in.
3. Go to API Keys.
4. Create a new key.
5. Copy it and set it as `GROQ_API_KEY` in your `.env` file.

### B) 📰 NewsAPI Key

1. Open: https://newsapi.org/
2. Click Get API Key and create an account.
3. Verify email if required.
4. Copy your API key from dashboard.
5. Set it as `NEWS_API_KEY` in your `.env` file.

### C) 🌦️ OpenWeather API Key

1. Open: https://openweathermap.org/api
2. Sign up or log in.
3. Go to API keys in your account.
4. Create/copy your key.
5. Set it as `WEATHER_API_KEY` in your `.env` file.

⏳ Note: OpenWeather keys can take a few minutes to become active.

---

## 3) ⚙️ Environment Setup

Create a `.env` file in the backend folder:

```env
GROQ_API_KEY=your_groq_key_here
NEWS_API_KEY=your_newsapi_key_here
WEATHER_API_KEY=your_openweather_key_here
PORT=5000
```

🔒 Important security note:

- Never commit real API keys to GitHub.
- If keys were exposed, rotate/regenerate them immediately.

---

## 4) 🚀 Install and Run

From backend folder:

```bash
npm install
```

Run in development mode (auto-restart):

```bash
npm run dev
```

Run normally:

```bash
npm start
```

Server default URL:

- `http://localhost:5000`

---

## 5) 🩺 Quick Health Check

Endpoint:

- `GET /api/health`

Example:

```bash
curl http://localhost:5000/api/health
```

Expected response shape:

```json
{
  "status": "online",
  "groq": true,
  "news": true,
  "weather": true
}
```

If any key is missing, the corresponding field becomes `false`.

---

## 6) 🌐 Main Backend Endpoints

1. `POST /api/chat`

- Proxies chat requests to Groq.
- Supports model + tools.

Example body:

```json
{
  "model": "llama-3.3-70b-versatile",
  "stream": false,
  "messages": [{ "role": "user", "content": "What is the weather in Delhi?" }]
}
```

2. `GET /api/news?topic=technology`

- Fetches latest news.
- `topic` is optional.

3. `GET /api/weather?city=Delhi`

- Fetches current weather for a city.

4. `GET /api/history`

- Returns last 20 chat messages from SQLite.

5. `GET /api/health`

- Service and key availability check.

---

## 7) 🗄️ Database

- File: `jarvis.db`
- Engine: SQLite
- Table auto-created on startup: `messages`

Schema:

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `role` TEXT
- `content` TEXT
- `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP

---

## 8) 🛠️ Troubleshooting

1. Health says a key is false

- Check key names in `.env`.
- Restart server after editing `.env`.

2. News not loading

- Confirm NewsAPI account is active.
- Check plan limits and daily quota.

3. Weather returns city error

- Try correct city spelling.
- Verify OpenWeather key activation.

4. Chat API errors

- Verify `GROQ_API_KEY` is valid and not expired.
- Ensure selected model name is supported by your Groq account.

---

## 9) 📜 Project Scripts

From `package.json`:

- `npm start` -> `node server.js`
- `npm run dev` -> `nodemon server.js`

---

## 10) 💡 Recommended Next Improvement

Create a `.env.example` file with placeholders so setup is easier and secrets are never shared.
