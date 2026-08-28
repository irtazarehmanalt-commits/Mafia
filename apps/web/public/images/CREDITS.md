# Image credits

All photographs are from [Unsplash](https://unsplash.com) and used under the
[Unsplash License](https://unsplash.com/license) (free for commercial and
non-commercial use, no attribution required — credited here anyway).

They are vendored into `public/` rather than hot-linked, so the app has no
runtime dependency on a third-party CDN.

| File                   | Unsplash photo ID                    | Subject                            |
| ---------------------- | ------------------------------------ | ---------------------------------- |
| `hero-noir.jpg`        | `photo-1641317113954-c51a2d66f5df`   | Street light on a foggy night      |
| `lobby-street.jpg`     | `photo-1648504149855-26e9fe360dea`   | Dark street with street lights     |
| `night-moon.jpg`       | `photo-1507502707541-f369a3b18502`   | Moon behind dark clouds            |
| `day-mist.jpg`         | `photo-1553696211-c396d7be9db9`      | Village under morning fog          |
| `dusk-vote.jpg`        | `photo-1585817934451-158d9f444228`   | Tree silhouettes at sunset         |
| `gameover-fog.jpg`     | `photo-1676493172304-5243482241fe`   | Foggy street at night              |
| `smoke.jpg`            | `photo-1585644156378-72d15fa33be5`   | Smoke against a dark background    |
| `grain.jpg`            | `photo-1670056763246-d2782ba17fe0`   | Creased black paper (grain texture)|
| `roles/mafia.jpg`      | `photo-1777135434585-10682a442b1f`   | Figure in a fedora, in shadow      |
| `roles/detective.jpg`  | `photo-1767169720650-a332388d9da6`   | Figure in a trench coat at a window|
| `roles/doctor.jpg`     | `photo-1764345676856-eaf84d541dc9`   | Dark hospital corridor             |
| `roles/civilian.jpg`   | `photo-1773083405815-34ea5253db0b`   | Silhouettes emerging from fog      |

To re-download or swap any of them, edit the table in `tools/fetch-images.mjs`
and run `npm run assets:fetch`.
