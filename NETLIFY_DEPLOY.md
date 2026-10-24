# Deploy from GitHub with Netlify

Netlify serves the website. The Flask API, SQLite database, and uploaded files run on the Render service declared in `render.yaml`; Netlify proxies API and upload requests to it so the browser keeps using one site address.

## Deploy the backend first

1. In Render, create a Blueprint from this same GitHub repository and apply `render.yaml`.
2. Wait for the `kisan-mantri` web service to deploy. Its default URL is `https://kisan-mantri.onrender.com`.
3. Open `https://kisan-mantri.onrender.com/api/marketplace/health` and confirm it responds successfully.

The Blueprint mounts a persistent disk at `/var/data`; the Flask app stores its SQLite database and uploads there. Persistent disks require a paid Render web service and only data written under the mount path survives restarts and deploys. If Render gives the service a different URL, replace `kisan-mantri.onrender.com` in the proxy targets in `netlify.toml` with the actual service URL.

## Connect the GitHub repository to Netlify

1. In Netlify, choose **Add new site → Import an existing project** and select this GitHub repository.
2. Leave the base directory empty. `netlify.toml` sets the build command to `npm run build:auth` and the publish directory to `frontend`.
3. Deploy the site. The `netlify.toml` rewrite rules proxy `/api/*`, `/uploads/*`, `/send_otp`, `/verify_otp`, and `/agriverse` to Render.
4. Open the Netlify site URL and create a farmer account. The database on Render starts empty; local laptop records and uploads are not copied from GitHub.

After deployment, check the Netlify URL at `/api/marketplace/health`. The response should come from the Render backend. Netlify's external proxy has a 26-second timeout, so large or slow video uploads may need direct object storage or a different upload path.
