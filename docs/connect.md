# Reach Lankki from your phone

Lankki runs on a computer in your home. Your phone needs a way to reach it, and that way should be **secure
(`https://`)**: phones only allow the camera (barcodes, food photos) and "Add to Home Screen" on secure addresses.

Pick one of these. If you're not sure, choose **Tailscale**.

| | Good for | Works away from home | Cost | Effort |
|---|---|---|---|---|
| [A. Tailscale](#a-tailscale-recommended-for-families) | a family or a few friends | yes | free | 10 minutes |
| [B. Cloudflare Tunnel](#b-cloudflare-tunnel-a-public-address) | a club or friends who won't install anything | yes | free (needs a domain) | 20 minutes |
| [C. Your own domain + Caddy](#c-your-own-domain-and-caddy) | people who already run a home server | yes | domain only | most |
| [D. Home Wi-Fi only](#d-just-trying-it-out-home-wi-fi) | trying it out | no | free | none |

---

## A. Tailscale (recommended for families)

[Tailscale](https://tailscale.com) is a free app that links your devices into a private network, wherever they are.
Nobody outside that network can even see Lankki.

1. Install Tailscale on the computer running Lankki and sign in ([instructions](https://tailscale.com/download)).
2. In the Tailscale admin page, open **DNS** and turn on **MagicDNS** and **HTTPS Certificates**.
3. On the Lankki computer, run:
   ```sh
   tailscale serve --bg 8790
   ```
   It prints your address, something like `https://lankki-box.tail1234.ts.net`.
4. Install Tailscale on each phone, signed in to the same network, and open that address.

To add family members, invite them to your Tailscale network (free for personal use), then send them a Lankki invite link.

## B. Cloudflare Tunnel (a public address)

Gives Lankki an address like `https://lankki.yourname.com` that works from any phone, without opening anything on
your router. You need a domain that uses Cloudflare (a free account is enough).

1. In the [Cloudflare dashboard](https://one.dash.cloudflare.com), go to **Networks → Tunnels → Create a tunnel**,
   choose **Cloudflared**, give it a name, and pick **Docker**. Copy the long token from the command it shows.
2. Put it in your `.env` file (copy `.env.example` to `.env` first):
   ```
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```
3. Back in Cloudflare, add a **Public hostname**: your subdomain and domain, service type **HTTP**, URL **`app:8000`**.
4. Start Lankki with the tunnel:
   ```sh
   docker compose --profile tunnel up -d
   ```

5. Also set `LANKKI_PUBLIC_URL=https://lankki.yourname.com` in `.env`, so invite links use that address.

Anyone can now see your login page (not your data). Lankki is built for that: accounts can only be created through
your invite links, passwords need 10+ characters, repeated wrong passwords are blocked for 15 minutes, plain http is
sent to https, and the tunnel can only reach the Lankki app, not your database or anything else on your network.

## C. Your own domain and Caddy

If you already forward ports 80 and 443 to a server, [Caddy](https://caddyserver.com) gets an https certificate
automatically. Point your domain's DNS at your home address, then in your Caddyfile:

```
lankki.example.com {
    reverse_proxy localhost:8790
}
```

## D. Just trying it out (home Wi-Fi)

Open `http://<the computer's address>:8790` on a phone on the same Wi-Fi (find the address with `hostname -I` on
Linux, or in your router's device list). Everything works except the camera and installing it to the home screen.

---

## Add Lankki to your home screen

- **iPhone**: open your Lankki address in Safari → Share → **Add to Home Screen**.
- **Android**: open it in Chrome → ⋮ menu → **Add to Home screen** (or **Install app**).

It then opens full-screen like an app, and you can log food even without a connection.

## Connect your watch

In Lankki: **Me → Watch connections**.

- **Garmin** (and Wahoo, Coros, Suunto, Polar…): through the free [intervals.icu](https://intervals.icu). Link your
  watch there once, then paste your intervals.icu athlete ID and API key into Lankki. New activities arrive within 30 minutes.
- **Apple Watch**: through the iPhone app **Health Auto Export** (its Premium REST API automation). Lankki shows the
  address and the secret to paste in. Your Lankki address must be reachable from the iPhone (any option above).
- **Anything else**: upload FIT, GPX or TCX files, or your whole Strava export, on **Me → Upload activities**.
