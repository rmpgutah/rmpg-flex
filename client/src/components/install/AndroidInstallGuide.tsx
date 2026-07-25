// Detailed Android installation guide for the public /downloads page.
// The APK is distributed inside a .zip because browsers and Play Protect
// block direct .apk downloads from non-Play sources.
import { Bullets, Callout, GuideFrame, GuideHeading, Step, Troubleshooting } from './InstallGuideParts';

export default function AndroidInstallGuide({ apkName }: { apkName: string }) {
  return (
    <GuideFrame
      title="Android Installation — Full Walkthrough"
      intro="Installs RMPG Flex on a phone or tablet for field use — mobile dispatch, field photos, ALPR plate scanning, and forms. Because the app is issued internally rather than through the Play Store, Android asks for one extra permission along the way."
    >
      <GuideHeading>Before you begin</GuideHeading>
      <Bullets
        items={[
          <>Android 8.0 (Oreo) or later.</>,
          <>About 200 MB of free storage.</>,
          <>Your RMPG Flex sign-in credentials, issued by an administrator.</>,
          <>A few minutes on Wi-Fi — the download is large for a cellular connection.</>,
        ]}
      />

      <GuideHeading>Installation</GuideHeading>
      <div className="space-y-0">
        <Step n={1} title="Download the package">
          Tap the Android download button above. You will get a <code>.zip</code> file. If your browser
          warns that the file may be harmful, choose <strong>Download anyway</strong> — see the note at
          the bottom for why.
        </Step>

        <Step n={2} title="Find and extract it">
          Open your <strong>Files</strong> app (called <strong>My Files</strong> on Samsung) and go to the
          <strong> Downloads</strong> folder. Tap the <code>.zip</code> file, then tap
          <strong> Extract</strong> and confirm. This produces <code>{apkName}</code> in the same folder.
        </Step>

        <Step n={3} title="Open the extracted APK">
          Tap the extracted <code>{apkName}</code> file. Android will show an install prompt — or ask for
          permission first, which is Step 4.
        </Step>

        <Step n={4} title="Allow installs from this app">
          If Android says your Files app is "not allowed to install unknown apps", tap
          <strong> Settings</strong> in that prompt, turn on <strong>Allow from this source</strong>, then
          press Back. The install prompt returns. You only do this once, and it applies only to the app
          you granted it to.
        </Step>

        <Step n={5} title="Install and open">
          Tap <strong>Install</strong>, then <strong>Open</strong> when it finishes. If Play Protect asks
          about scanning, either choice is fine — tap <strong>Install anyway</strong> if it offers to
          block.
        </Step>

        <Step n={6} title="Sign in and allow permissions">
          Sign in with your issued credentials. Grant <strong>Location</strong> (unit tracking and
          navigation) and <strong>Camera</strong> (field photos and plate scanning) when prompted — the
          field features do not work without them. For live unit tracking while the screen is off, choose
          <strong> Allow all the time</strong> for location if offered.
        </Step>
      </div>

      <GuideHeading>Troubleshooting</GuideHeading>
      <Troubleshooting
        items={[
          {
            symptom: '"App not installed" or "Package appears to be invalid"',
            fix: <>Usually an incomplete download or an attempt to install straight from inside the zip viewer. Delete both files, re-download on Wi-Fi, and extract fully before tapping the APK.</>,
          },
          {
            symptom: 'Cannot find the downloaded file',
            fix: <>Open your browser's Downloads list and tap the file there, or search for the filename in the Files app. On some devices it lands in <code>Internal storage → Download</code>.</>,
          },
          {
            symptom: 'No Extract option when tapping the zip',
            fix: <>Your file manager may not handle archives. Use the built-in Files/My Files app rather than a third-party one, or install any free unzip utility from the Play Store.</>,
          },
          {
            symptom: 'Play Protect blocked the install',
            fix: <>Tap <strong>More details</strong> → <strong>Install anyway</strong>. Play Protect flags anything not distributed through the Play Store, regardless of what the app does.</>,
          },
          {
            symptom: 'Map or GPS features not working',
            fix: <>Open <strong>Settings → Apps → RMPG Flex → Permissions</strong> and confirm Location and Camera are allowed. Turn the phone's location services on if they are off.</>,
          },
          {
            symptom: 'Need to update later',
            fix: <>Download the newer package from this page and install it over the top — your data and sign-in are preserved. Do not uninstall first.</>,
          },
        ]}
      />

      <Callout label="Why the app is a .zip">
        Chrome and most Android browsers block <code>.apk</code> files downloaded outside the Play Store,
        and Play Protect flags them on install. Delivering the app inside a <code>.zip</code> lets the
        download complete normally. The file inside is the real, unmodified app.
      </Callout>

      <GuideHeading>Prefer not to install anything?</GuideHeading>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--rmpg-400)' }}>
        Open <code>rmpgutah.us</code> in Chrome and use the browser menu → <strong>Add to Home screen</strong>.
        That gives you an app-like icon with most of the same functionality — useful for a personal device
        or a quick loaner. The installed app is still the better choice for daily field work: it handles
        poor connectivity and background location far better.
      </p>
    </GuideFrame>
  );
}
