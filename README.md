# Kiri Kanan!

A rally game for two in the browser. One person drives without knowing what the road does next and with no brakes. The other has the map and calls out left, right or straight.

## Running it locally
```bash
cd ~/Documents/kiri-kanan
python3 -m http.server 8765
# open http://localhost:8765
```
Opening it from `file://` won't work. The browser needs a server to load the 3D models.

## Playing with a friend
1. Player 1 presses **Buat Room** and gets a 4-letter code (or copies the invite link).
2. Player 2 types the code and presses **Gabung**.
3. The host picks the roles (Tukar peran), the fog level and the track, then presses **Mulai!**

The connection is peer to peer over WebRTC via PeerJS, so there is no server of your own to run. **Both players have to open the same website**, so to play across different networks the folder needs to be hosted somewhere: GitHub Pages, Netlify Drop or Vercel (all free). Voice chat (🎤) only works over https.

## Controls
| Driver | Navigator |
|---|---|
| W / ↑ / Space = gas | ← / A = "KIRI!" |
| A D / ← → = steer | → / D = "KANAN!" |
| R = back on the road (+10s) | ↑ / W = "LURUS!" |
| V = cockpit / chase camera | ↓ / S = "PELAN!", G = "GAS!" |

Penalties: hitting a tree adds +3s, going off the stage adds +10s. Medals: 🥇🥈🥉.

**Obstacles** (all of them show up on the navigator's map):
- 🛫 **JUMP!** Purple ramps. You can't steer in the air, and some of them launch you straight into a corner.
- 🌉 **SKINNY BRIDGE**: a narrow bridge over a river. Miss it and you splash in (+10s).
- ⚠ **CLIFF OUTSIDE**: a drop on the outside of the corner (red dashed line on the map). Fall off and it's +10s.
- 💥 The windshield cracks more every time you crash.
It works on phones too (touch buttons for the driver, a big tablet screen for the navigator).

## Credits
3D models (red truck, forest) and sounds (engine, skid, impact): [Kenney Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing), CC0.
Libraries: three.js, PeerJS.
