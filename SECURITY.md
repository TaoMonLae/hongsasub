# Security Policy

## Supported versions

HongsaSub is in early alpha. Only the latest commit on `main` receives security fixes.

## What HongsaSub does with your data

- Your translation memory, glossary, style library and personal word list are stored only on your computer, in the app's data folder.
- HongsaSub makes no network requests of its own. It runs a small media server for video playback that listens only on `127.0.0.1`.
- Videos are read with ffmpeg and ffprobe installed on your system. Converted preview copies are kept in the app's cache folder.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub instead: go to the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and what someone could do with it
- steps to reproduce it, for example a crafted subtitle, project or video file
- the HongsaSub version or commit, and your operating system

You should get a reply within 7 days. Once the problem is confirmed, a fix will be prepared, and you will be credited in the release notes unless you would rather not be.

## Areas of most interest

- Crafted `.srt`, `.ass`, `.ssa` or `.hongsa` files that crash the app, write outside the chosen location, or run code.
- The local media server serving files other than the attached video.
- Paths or file names passed to ffmpeg or ffprobe.
