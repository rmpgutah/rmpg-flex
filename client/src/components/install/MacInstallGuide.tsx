// Detailed macOS installation guide for the public /downloads page.
//
// Two facts drive this whole page, both read from the real electron-builder
// config in desktop/package.json rather than assumed:
//   1. The mac target builds arm64 ONLY — this is an Apple Silicon build.
//      An Intel Mac cannot run it. (The old page copy claimed Intel was
//      supported; it never was.)
//   2. build:mac passes -c.mac.identity=null, so the app is UNSIGNED and
//      un-notarized. Gatekeeper will refuse it until quarantine is cleared,
//      which is why the terminal steps below are mandatory, not optional
//      troubleshooting.
import { Bullets, Callout, Cmd, GuideFrame, GuideHeading, Step, Troubleshooting } from './InstallGuideParts';

export default function MacInstallGuide() {
  return (
    <GuideFrame
      title="macOS Installation — Full Walkthrough"
      intro="Installs RMPG Flex as a native Mac application. Two Terminal commands are required because the app is distributed internally rather than through the App Store — copy buttons are provided for each."
    >
      <GuideHeading>Before you begin</GuideHeading>
      <Bullets
        items={[
          <><strong>Apple Silicon Mac required</strong> (M1, M2, M3, M4 or later). This build does not run on Intel Macs — on an Intel Mac, use the web app at rmpgutah.us instead.</>,
          <>macOS 11 Big Sur or later.</>,
          <>An administrator password — one of the two commands below uses <code>sudo</code>.</>,
          <>About 600 MB of free disk space.</>,
        ]}
      />
      <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--text-secondary)' }}>
        Not sure which Mac you have? Click the Apple menu → <strong>About This Mac</strong>. If the Chip
        line says "Apple M…", you are on Apple Silicon and good to go.
      </p>

      <GuideHeading>Installation</GuideHeading>
      <div className="space-y-0">
        <Step n={1} title="Download the disk image">
          Use the macOS download button above to get the <code>.dmg</code> file. Leave it in your
          Downloads folder — the commands below assume it is there.
        </Step>

        <Step n={2} title="Clear the download quarantine flag">
          Open Terminal (press <strong>Cmd + Space</strong>, type <em>Terminal</em>, press Return) and run:
          <Cmd>{'xattr -d com.apple.quarantine ~/Downloads/RMPG*Flex*.dmg'}</Cmd>
          If it reports "No such xattr", the flag was already absent — that is fine, continue.
        </Step>

        <Step n={3} title="Install the app">
          Double-click the <code>.dmg</code> to open it, then drag the <strong>RMPG Flex</strong> icon onto
          the <strong>Applications</strong> folder shortcut in the same window. Wait for the copy to
          finish, then eject the disk image (click the ⏏ next to it in Finder's sidebar).
        </Step>

        <Step n={4} title="Clear quarantine on the installed app">
          Back in Terminal, run this and enter your Mac password when prompted (the password will not
          appear as you type — that is normal):
          <Cmd>{'sudo xattr -cr /Applications/RMPG\\ Flex.app'}</Cmd>
        </Step>

        <Step n={5} title="First launch">
          Open Applications, <strong>right-click</strong> (or Control-click) RMPG Flex, choose
          <strong> Open</strong>, then click <strong>Open</strong> in the dialog. You only need the
          right-click the first time — after that it launches normally from the Dock or Launchpad.
        </Step>

        <Step n={6} title="Sign in">
          Sign in with your issued RMPG Flex credentials. Accounts are created by an administrator; there
          is no self-registration.
        </Step>
      </div>

      <GuideHeading>After installation</GuideHeading>
      <Bullets
        items={[
          <><strong>Automatic updates:</strong> the app checks for new versions on launch and updates itself.</>,
          <><strong>Keep it in the Dock:</strong> right-click the running app's Dock icon → Options → Keep in Dock.</>,
          <><strong>Offline capability:</strong> the desktop app keeps working through connection dropouts and syncs when service returns.</>,
        ]}
      />

      <GuideHeading>Troubleshooting</GuideHeading>
      <Troubleshooting
        items={[
          {
            symptom: '"RMPG Flex is damaged and can\'t be opened. You should move it to the Trash."',
            fix: <>This is the quarantine flag, not real damage — it appears when Step 2 or Step 4 was skipped. Run <strong>both</strong> commands above (Steps 2 and 4), then try opening again. This alarming wording is simply what macOS says about any unsigned app.</>,
          },
          {
            symptom: '"Apple could not verify RMPG Flex is free of malware"',
            fix: <>Same cause. Run the Step 4 command, then right-click the app and choose <strong>Open</strong> rather than double-clicking.</>,
          },
          {
            symptom: '"The application cannot be opened because it is not supported on this Mac"',
            fix: <>You are on an Intel Mac. This build is Apple Silicon only — use the web app at <code>rmpgutah.us</code>, which has the same features apart from GPS and serial hardware access.</>,
          },
          {
            symptom: 'Terminal says "No such file or directory"',
            fix: <>The <code>.dmg</code> is not in your Downloads folder, or the app is not in Applications yet. Confirm Step 3 finished copying before running the Step 4 command.</>,
          },
          {
            symptom: 'Want a clean reinstall',
            fix: <>Quit the app, drag <strong>RMPG Flex</strong> from Applications to the Trash, then repeat from Step 1.</>,
          },
        ]}
      />

      <Callout label="Why the Terminal steps are required">
        The app is distributed internally to RMPG personnel rather than through the Mac App Store, so it
        is not signed with an Apple Developer certificate. macOS tags anything downloaded from the web
        with a quarantine attribute and refuses to launch unsigned apps that carry it. The two commands
        remove that attribute. They do not disable Gatekeeper or weaken security anywhere else on your
        Mac — they apply only to this one file and this one app.
      </Callout>
    </GuideFrame>
  );
}
