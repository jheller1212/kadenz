# Kadenz — Third-Party Dependencies

All dependencies must be MIT-compatible. This file documents license and ToS compliance for each.

---

## Web (Next.js)

| Package | Version | License | Notes |
|---|---|---|---|
| `next` | 16.x | MIT | Next.js framework. MIT licensed. [Vercel ToS](https://vercel.com/legal/terms) applies only if hosted on Vercel; self-hosted is unrestricted. |
| `react` | 19.x | MIT | Meta. No restrictions. |
| `react-dom` | 19.x | MIT | Meta. No restrictions. |
| `@dnd-kit/core` | 6.x | MIT | Drag-and-drop primitives. No restrictions. |
| `@dnd-kit/sortable` | 10.x | MIT | Sortable preset for dnd-kit. No restrictions. |
| `@dnd-kit/utilities` | 3.x | MIT | Utility helpers for dnd-kit. No restrictions. |
| `drizzle-orm` | 0.45.x | Apache-2.0 | Apache-2.0 is MIT-compatible for use (permissive, no copyleft). No restrictions on use. |
| `drizzle-kit` | 0.31.x | Apache-2.0 | Dev tool only (migrations, schema push). Same as above. |
| `postgres` | 3.x | MIT | Postgres driver. No restrictions. |
| `googleapis` | 171.x | Apache-2.0 | Google's official Node.js client library. Apache-2.0. Usage subject to [Google APIs Terms of Service](https://developers.google.com/terms). OAuth2 token usage must comply with Google's user data policy. |
| `lucide-react` | 1.x | ISC | ISC is MIT-equivalent. No restrictions. |
| `zod` | 4.x | MIT | Schema validation. No restrictions. |
| `date-fns` | 4.x | MIT | Date utilities. No restrictions. |
| `tailwindcss` | 4.x | MIT | CSS framework. Dev dependency. No restrictions. |
| `typescript` | 5.x | Apache-2.0 | Dev dependency. Apache-2.0. No restrictions. |
| `eslint` | 9.x | MIT | Dev dependency. No restrictions. |
| `eslint-config-next` | 16.x | MIT | Dev dependency. No restrictions. |
| `@tailwindcss/postcss` | 4.x | MIT | Dev dependency. No restrictions. |
| `tsx` | 4.x | MIT | Dev dependency. No restrictions. |

---

## Python (garmin-worker)

| Package | Version | License | Notes |
|---|---|---|---|
| `fastapi` | 0.136.x | MIT | Web framework. No restrictions. |
| `uvicorn` | 0.46.x | BSD-3-Clause | BSD-3 is MIT-compatible. No restrictions. |
| `garth` | 0.8.x | MIT | Reverse-engineered Garmin Connect client. MIT licensed. **ToS risk**: Garmin's Terms of Service prohibit unauthorized automated access to Garmin Connect. Personal, non-commercial use of this single-user tool is low risk but not zero risk. See ADR-0001 and SECURITY.md. |
| `pydantic` | 2.x | MIT | Data validation. No restrictions. |
| `httpx` | 0.28.x | BSD-3-Clause | BSD-3 is MIT-compatible. No restrictions. |
| `python-dotenv` | 1.x | BSD-3-Clause | BSD-3 is MIT-compatible. No restrictions. |

---

## ToS Compliance Summary

### Google Calendar API
- Governed by [Google APIs Terms of Service](https://developers.google.com/terms) and [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- Single-user app accessing the owner's own calendar: compliant
- Must not store tokens longer than necessary; implement refresh token rotation
- Must not share or sell calendar data

### Strava API
- Governed by [Strava API Agreement](https://www.strava.com/legal/api)
- Webhook usage for personal data sync: compliant
- Must not store or expose other athletes' data
- Webhook subscription requires approval from Strava for public apps; for personal/private use, a subscription to your own account is acceptable

### Garmin Connect (via garth)
- **No official API exists** for Garmin Connect activity sync
- `garth` reverse-engineers the SSO flow; this is not sanctioned by Garmin
- Garmin's ToS prohibits automated access to Garmin Connect
- **Risk acceptance**: This is a personal tool for personal data. Not commercial. Not redistributing data. Risk is low but non-zero. Garmin could block the account or change the auth flow at any time.
- Mitigation: rate-limit, handle failures gracefully, do not store Garmin password in DB. See SECURITY.md.

---

## License Compatibility Summary

All production dependencies are MIT, Apache-2.0, BSD-3, or ISC — all permissive licenses compatible with the MIT license of this project. No GPL or AGPL dependencies are present. No copyleft obligations apply.
