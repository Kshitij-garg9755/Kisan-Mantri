# Deploy the full Smart Farm app on Netlify

The production site is a static frontend served from `frontend/`, with its API in Netlify Functions (`netlify/functions/api.mjs`). The API uses Netlify Database (Postgres) for relational data and Netlify Blobs for user uploads. `app.py` remains available for local Flask development; Netlify does not start it as a server.

## What is connected to the cloud backend

The Functions API covers Gmail/password authentication and sessions, profile photos, saved land measurements, Agriverse posts/reels/follows/comments/messages, Chaupal community posts and interactions, marketplace products/cart/checkout/orders/delivery workflows, schemes and bookmarks, bank information, diagnosis history, saved satellite fields, radio programs, notifications, weather/forecast/geocoding, mandi prices, chat, OTP compatibility routes, and legacy farmer endpoints. User uploads are stored in Netlify Blobs and served from `/uploads/*`. Large Agriverse videos upload in chunks so each Function request stays below Netlify's binary request limit.

Some existing capabilities still need their provider configuration: chat requires `OPENAI_API_KEY`; current-weather lookup requires `OPENWEATHER_API_KEY`; mandi prices require `AGMARKNET_API_KEY`; SMS OTP requires `TWILIO_SID`, `TWILIO_AUTH`, and `TWILIO_FROM`. Gmail/password signup and login do not need those providers. Crop disease diagnosis remains a clearly labeled demo; a real model is not connected to the Functions backend yet. Satellite imagery maps work, while real NDVI analysis is not connected. Firebase phone login is disabled in the Netlify Functions backend; the app's Gmail/password flow is supported.

## Connect and deploy from GitHub

1. Push the repository to GitHub and import it in Netlify. Set the repository root as the base directory. `netlify.toml` sets the build command and publishes `frontend/`.
2. Enable Netlify Database for the site. The `@netlify/database` package and SQL migration under `netlify/database/migrations/` provision/use the Postgres database and create the application tables during deploy.
3. Add any provider keys listed above in **Site configuration → Environment variables**, then deploy the `main` branch.
4. Open `/api/health` on the Netlify domain, then create an account at `/pages/login.html`. Verify the account can log in again after closing and reopening the browser.

Netlify Database is available on credit-based plans; database compute and bandwidth use credits. Check your Netlify plan and usage before turning on the database.

## Existing local data

The local SQLite files and uploads are ignored by Git and are not copied by deployment. The Netlify database starts with the scheme and radio starter records in the migration, and new accounts/data are saved in Postgres/Blobs. Existing farmer accounts, marketplace records, posts, and media need an explicit one-time import if they must be preserved. Do not commit `.env`, database files, or credentials to GitHub.

## Local development

Run `npm install`, then `npx netlify dev` to serve the static frontend and Functions locally. Netlify Database's local workflow is available through the Netlify CLI; local Flask development through `python app.py` continues to use SQLite and is separate from production data.
