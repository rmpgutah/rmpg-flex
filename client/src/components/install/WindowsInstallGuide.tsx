// Detailed Windows installation guide for the public /downloads page.
// Facts here are taken from the real electron-builder config in
// desktop/package.json — NSIS target, x64 only, perMachine (so the install
// genuinely needs an administrator prompt), a user-selectable install
// directory, and Desktop + Start Menu shortcuts named "RMPG Flex".
import { Bullets, Callout, Cmd, GuideFrame, GuideHeading, Step, Troubleshooting } from './InstallGuideParts';

export default function WindowsInstallGuide({ exeName }: { exeName: string }) {
  return (
    <GuideFrame
      title="Windows Installation — Full Walkthrough"
      intro="Installs RMPG Flex as a native desktop application with offline support, GPS/serial hardware access, and automatic updates. Takes about three minutes."
    >
      <GuideHeading>Before you begin</GuideHeading>
      <Bullets
        items={[
          <>Windows 10 or Windows 11, <strong>64-bit (x64)</strong>. There is no 32-bit or ARM build.</>,
          <>Administrator rights on the machine — the installer writes to Program Files for all users, so Windows will show a User Account Control prompt.</>,
          <>About 600 MB of free disk space.</>,
          <>Your RMPG Flex sign-in credentials. Accounts are created by an administrator; there is no self-registration.</>,
        ]}
      />

      <GuideHeading>Installation</GuideHeading>
      <div className="space-y-0">
        <Step n={1} title="Download the package">
          Use the Windows download button above. You will get a <code>.zip</code> file. If your browser
          asks whether to keep the file, choose Keep — see the SmartScreen note at the bottom for why the
          installer is delivered zipped.
        </Step>

        <Step n={2} title="Extract the zip">
          Open your Downloads folder, right-click the downloaded <code>.zip</code>, and choose
          <strong> Extract All…</strong> → <strong>Extract</strong>. Do not try to run the installer from
          inside the zip preview window — Windows runs it from a temporary folder and the install can fail
          partway.
        </Step>

        <Step n={3} title="Run the installer">
          Open the extracted folder and double-click <code>{exeName}</code>. Click <strong>Yes</strong> at
          the User Account Control prompt. You can accept the default install location or click
          <strong> Browse</strong> to choose your own.
        </Step>

        <Step n={4} title="Get past SmartScreen if it appears">
          If a blue "Windows protected your PC" window appears, click <strong>More info</strong>, then
          <strong> Run anyway</strong>. This is expected — see the note at the bottom.
        </Step>

        <Step n={5} title="Launch and sign in">
          The installer creates a <strong>RMPG Flex</strong> shortcut on your Desktop and in the Start
          Menu. Launch it and sign in with your issued credentials. On first launch the app connects to
          rmpgutah.us and loads your dispatch console.
        </Step>
      </div>

      <GuideHeading>After installation</GuideHeading>
      <Bullets
        items={[
          <><strong>Automatic updates:</strong> the app checks for new versions on launch and updates itself. You do not need to return to this page for future releases.</>,
          <><strong>Offline capability:</strong> the desktop app keeps a local copy of working data, so it stays usable through a dead-zone and syncs back when the connection returns.</>,
          <><strong>Hardware access:</strong> the desktop build can reach GPS receivers and serial devices that a browser cannot — this is the main reason to install it on a patrol laptop rather than using the web app.</>,
        ]}
      />

      <GuideHeading>Troubleshooting</GuideHeading>
      <Troubleshooting
        items={[
          {
            symptom: '"Windows protected your PC" and no Run anyway option',
            fix: <>Click <strong>More info</strong> first — the <strong>Run anyway</strong> button only appears after that. If your organization has blocked it entirely, right-click the <code>.exe</code> → <strong>Properties</strong> → tick <strong>Unblock</strong> at the bottom → <strong>OK</strong>, then run it again.</>,
          },
          {
            symptom: 'The download disappears or is deleted immediately',
            fix: <>Your browser or antivirus removed it. Open your browser downloads list and choose Keep/Restore, or temporarily allow the download, then re-download.</>,
          },
          {
            symptom: 'Installer does nothing when double-clicked',
            fix: <>You are almost certainly still inside the zip preview. Extract the folder first (Step 2), then run the installer from the extracted location.</>,
          },
          {
            symptom: 'App opens to a blank window or a connection error',
            fix: <>Confirm the machine can reach the site by opening <code>https://rmpgutah.us</code> in a browser. If the browser works but the app does not, close the app fully and relaunch.</>,
          },
          {
            symptom: 'Wrong version installed / want a clean reinstall',
            fix: <>Uninstall via <strong>Settings → Apps → Installed apps → RMPG Flex → Uninstall</strong>, then run the installer again.</>,
          },
          {
            symptom: '"npm.ps1 cannot be loaded because running scripts is disabled on this system"',
            fix: <>This is PowerShell's execution policy blocking npm. Two options: (1) use <strong>Command Prompt (cmd.exe)</strong> instead of PowerShell — npm works fine there with no policy issues; or (2) in PowerShell run <Cmd>{'Set-ExecutionPolicy RemoteSigned -Scope CurrentUser'}</Cmd> once, then proceed normally.</>,
          },
        ]}
      />

      <GuideHeading>Building from source (FZ-55 / dev setup)</GuideHeading>
      <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-secondary)' }}>
        If a pre-built installer is not yet available, the Electron app can be run directly from source.
        Use <strong>Command Prompt (cmd.exe)</strong> — not PowerShell — to avoid execution-policy
        restrictions on npm.ps1:
      </p>
      <Cmd>{`git clone https://github.com/rmpgutah/rmpg-flex.git "C:\\RMPG Flex"
cd "C:\\RMPG Flex\\desktop"
npm install
npm run rebuild
npm start`}</Cmd>
      <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--text-secondary)' }}>
        <code>npm run rebuild</code> compiles the native SQLite module for the local Node/Electron ABI.
        It requires <a href="https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--brand-gold)' }}>Visual Studio Build Tools</a>{' '}
        with the "Desktop development with C++" workload, or the equivalent MSYS2 toolchain.
        If build tools are not installed, <code>npm install</code> exits with a native module error — install them first, then re-run.
      </p>

      <Callout label="Why the installer is a .zip">
        Windows SmartScreen aggressively flags any <code>.exe</code> downloaded directly from the web
        until it has built up reputation, and some browsers block the download outright. Wrapping the
        installer in a <code>.zip</code> lets the download through cleanly. The file inside is the real,
        unmodified installer — nothing about it changes because of the wrapper.
      </Callout>

      <GuideHeading>Silent install (IT / fleet deployment)</GuideHeading>
      <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--text-secondary)' }}>
        For imaging multiple machines, the NSIS installer accepts standard silent-install flags. Run from
        an elevated command prompt:
      </p>
      <Cmd>{`"${exeName}" /S`}</Cmd>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        Add <code>/D=C:\\Path\\To\\Install</code> as the final argument to override the install directory
        (no quotes around the path, and it must be the last argument).
      </p>
    </GuideFrame>
  );
}
