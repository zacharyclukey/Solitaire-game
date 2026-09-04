# Releasing Facedown

Ordered, from a clean checkout to a build sitting in TestFlight and on Play's
internal test track. Steps marked **manual** cannot be automated from here.

## 0. Once, before the first release

- **manual** Join the Apple Developer Program, then register the App ID
  `com.facedown.game` and create the app record in App Store Connect.
- **manual** Create the Google Play Console app record for
  `com.facedown.game`.
- **manual** Generate an Android upload key and keep it somewhere you will not
  lose it — losing it means you can never update the app again:

  ```bash
  keytool -genkeypair -v \
    -keystore facedown-release.jks \
    -alias facedown \
    -keyalg RSA -keysize 4096 -validity 10000
  ```

  Put it at `android/facedown-release.jks` and create
  `android/keystore.properties` (both are gitignored):

  ```properties
  storeFile=facedown-release.jks
  storePassword=…
  keyAlias=facedown
  keyPassword=…
  ```

  CI can supply `FACEDOWN_KEYSTORE`, `FACEDOWN_KEYSTORE_PASSWORD`,
  `FACEDOWN_KEY_ALIAS` and `FACEDOWN_KEY_PASSWORD` instead of the file.
- **manual** Host `docs/store/privacy-policy.md` somewhere public and fill in
  the support address it asks for.

## 1. Every release

```bash
npm ci
npm run typecheck
npm test
npm run build            # also emits the offline service worker
npm run qa               # drives a real run in a browser; fails on any page error
npx cap sync             # copies dist/ into both native projects
```

Bump the version in three places and keep them in step:

| File | Field |
| --- | --- |
| `package.json` | `version` |
| `android/app/build.gradle` | `versionName`, and increment `versionCode` |
| Xcode → App target → General | Version, and increment Build |

## 2. Screenshots

```bash
npm run build
CHROMIUM_PATH=/path/to/chromium npm run screenshots
```

Writes `store/screenshots/<device>/` for iPhone 6.9", iPhone 6.5", iPad 13",
Android phone and Android tablet. **manual** Google also wants a 1024×500
feature graphic, which the script does not produce.

## 3. iOS

```bash
npx cap open ios
```

In Xcode: select the **App** target → Signing & Capabilities → your team, then
**Product → Archive** and distribute to App Store Connect.

Already configured, so do not re-do it by hand:

- Portrait-only on iPhone; portrait and upside-down on iPad. Landscape is not
  supported and is not claimed anywhere: a tableau of columns wants height, and
  a wide short board would either shrink the cards or crop the deepest column.
- The play column is capped at 560px wide and 980px tall and centred, so a
  tablet gets a board at a size a hand plays at rather than a phone layout
  stretched. Before that, card width was the viewport divided by the column
  count and iPad cards came out at 135px against 50px on a phone, with the
  tableau in the top half and dead space beneath it.
- Light status bar content, `UIRequiresFullScreen`.
- `ITSAppUsesNonExemptEncryption` false, so export compliance is answered on
  upload.
- `PrivacyInfo.xcprivacy` is in the Resources build phase.
- Icons and the launch screen are generated from `assets/`; regenerate with
  `npm run icons && npx capacitor-assets generate`.

**manual** In App Store Connect: fill the listing from `listing.md`, answer
App Privacy with "No, we do not collect data from this app", complete the age
rating questionnaire (all None — read the gambling note in `listing.md`), then
submit the build to TestFlight and, when you are ready, for review.

## 4. Android

```bash
cd android && ./gradlew bundleRelease
```

Produces `android/app/build/outputs/bundle/release/app-release.aab`, signed if
`keystore.properties` or the environment variables are present. If they are
not, the bundle is unsigned and the build prints a warning rather than failing.

**manual** Upload the `.aab` to the Play Console internal testing track,
complete the Data safety form and the IARC questionnaire from `listing.md`,
then promote when you are happy.

## 5. Web build (optional)

`dist/` is a static, installable PWA with an offline service worker — publish
it to any static host. `node scripts/build-standalone.mjs` bundles the entire
game into a single self-contained HTML file with no external requests, for
embedding or sharing as one link.

## Sanity checks before you ship

- [ ] `npm test` green, `npm run qa` green.
- [ ] Play a run on a real device: tap-to-move, drag-to-move, undo, hint,
      the pause menu, and killing the app mid-level to confirm it resumes.
- [ ] Aeroplane mode: the whole game still works.
- [ ] Settings → Erase all progress genuinely clears everything.
- [ ] Version and build numbers incremented in all three places.
