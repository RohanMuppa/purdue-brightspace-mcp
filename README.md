# Brightspace MCP Server

> **By [Rohan Muppa](https://github.com/rohanmuppa) — ECE @ Purdue**

Talk to your Brightspace courses with AI. Ask about grades, due dates, announcements, and more — right from Claude, ChatGPT, or Cursor.

Works with any school that uses Brightspace.

<p align="center">
  <img src="https://raw.githubusercontent.com/RohanMuppa/brightspace-mcp-server/main/docs/how-it-works.svg" alt="Architecture diagram" width="100%">
</p>

## Try It

> "What assignments are due this week?"
> "Show my grades for CS 252"
> "Download the lecture slides from Module 3"
> "Who is the instructor for MATH 266?"

## Get Started

**You need:** [Node.js 18+](https://nodejs.org/) (download the LTS version)

**Purdue students:**
```bash
npx brightspace-mcp-server setup --purdue
```

**Everyone else:**
```bash
npx brightspace-mcp-server setup
```

The wizard handles everything — credentials, MFA, and configuring your AI client. When it's done, restart Claude/ChatGPT/Cursor and start asking questions.

## Session Expired?

Sessions last about 1 hour. If you get an auth error:

```bash
npx brightspace-mcp-server auth
```

## What You Can Ask About

| Topic | Examples |
|-------|---------|
| Courses | "What are my courses?" |
| Grades | "What's my grade in CS 252?" |
| Assignments | "What's due this week?" |
| Announcements | "Any new announcements?" |
| Content | "Show me Module 3 files" |
| Downloads | "Download the syllabus" |
| Roster | "Who teaches this class?" |
| Discussions | "Show recent discussion posts" |

## Troubleshooting

**"Not authenticated"** — Run `npx brightspace-mcp-server auth`

**AI client not responding** — Quit and reopen it completely (not just close the window)

**Need to redo setup** — Run `npx brightspace-mcp-server setup` again

**Config location** — `~/.brightspace-mcp/config.json` (you can edit this directly)

## Security

- Credentials stay on your machine in `~/.brightspace-mcp/config.json` (restricted permissions)
- Session tokens are encrypted (AES-256-GCM)
- All traffic to Brightspace is HTTPS
- Nothing is sent anywhere except your school's login page

## Updates

Automatic. Your AI client pulls the latest version every time it starts — no action needed.

---

[Report a bug](https://github.com/rohanmuppa/brightspace-mcp-server/issues) · AGPL-3.0 · Copyright 2026 Rohan Muppa
