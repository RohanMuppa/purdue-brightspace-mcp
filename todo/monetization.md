# Monetization & Hosted Product

## The Vision
Move from self-hosted npm package → hosted web product students can use in 2 minutes.

## Target Audience
- Non-technical students (mainstream, not developers)
- Power users already using Claude Desktop (current audience)

## Approach Options (ranked by accessibility)

| Approach | Setup friction | Notes |
|----------|---------------|-------|
| Own chat UI at brightspacemcp.com/chat | Just log in | Best for mainstream students |
| Chrome extension | Install + log in | Good middle ground |
| MCP endpoint URL | Too technical | Current approach, developer-only |

## Recommended MVP: Chat Web App

Students go to `brightspacemcp.com/chat`, log in with Brightspace, get a chat interface powered by Claude. No config files, no terminal, no MCP endpoints.

### Auth Flow (Remote Browser)
1. Student clicks "Connect your school"
2. Select school or paste Brightspace URL
3. Remote browser streams to their tab (Browserbase/Steel.dev)
4. They log in + tap Duo MFA as normal
5. Session token captured, stored encrypted server-side
6. Done — chat works immediately

### Stack
- **Frontend + API:** Next.js on Vercel (free tier)
- **Auth browser:** Playwright on $4/mo Hetzner VPS or Browserbase
- **Token storage:** Supabase (free tier)
- **AI:** Claude Haiku (cheap, fast, good enough for structured lookups)
- **Payments:** Stripe

### Cost Per Student
- Browserbase auth: ~$0.10/user/month (only on login, not every request)
- Claude Haiku: ~$0.05-0.20/user/month (with caching)
- Total: ~$0.15-0.30/user/month

### Pricing
- Charge $3/month → profitable at any scale
- Free tier: X queries/month to let students try it

## Cost Optimizations
- Use `claude-haiku-4-5` not Opus (20x cheaper)
- Cache Brightspace data per user (grades don't change every minute)
- Only pull relevant context per query, not entire course list
- Cloudflare Workers for MCP proxy (free tier)

## Fixed Infrastructure Cost
~$4/month until meaningful scale (just the Hetzner VPS).

## Future
- Chrome extension for tighter Claude.ai / ChatGPT integration
- University licensing (pitch to IT/admin, not students)
- Add other LMS platforms (Canvas, Moodle, Blackboard) → unified product
