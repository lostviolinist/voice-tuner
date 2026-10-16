# Meloform

Make a whole new instrument with your voice! Sing a note, teach a synth your tone, then play a melody with your voice-instrument ♡

Inspired by [Handwired by Cheng Lou](https://github.com/chenglou/handwired).

[**Play Meloform →**](https://meloform-music.pages.dev/)

## Let’s make some music

### 1. Give it a little “ooo”

Click **Record my voice**, allow your microphone, and sing one comfortable note for two seconds. Try “ooo”, “aaa”, or “eee”—hold the vowel instead of saying the word. No perfect pitch needed!

You’ll see a countdown and a microphone meter while it listens. Your recording stays in your browser.

**No mic?** Click one of the sample vowels to hear it, then press **Train this sound**.

### 2. Hear your instrument come to life

After a successful recording, learning and playback start automatically. The synth begins with its current sound and gradually learns the tone of your vowel. Watch the two waves get closer as you listen.

Use **Hear target** and **Hear instrument** to compare them. **Original recording** lets you hear the voice you recorded.

### 3. Play a melody—or a whole piece

Your instrument has a full **88-key piano, from A0 to C8**. Scroll sideways to reach the low bass notes and the highest notes, and hold several keys together to play chords.

The default **Wide** computer-keyboard layout gives you **C3–C8 all at once**. Play the number row, then Q–P, A–L, and Z–M to move from low to high white notes. Hold **Shift** for the black note just above one of those notes. The **Computer key guide** shows every mapping, including flats.

Want to try Chopin’s Nocturne Op. 9 No. 2 in E-flat major? With Wide set to C3–C8, the opening melody is:

```text
⇧E  O  O  I  O  I  ⇧Y  ⇧E  O
B♭4 G5 G5 F5 G5 F5 E♭5 B♭4 G5
```

**⇧ means hold Shift with that key.** Play the rhythm yourself; these are note shortcuts, not automatic playback. You can play notes outside the visible part of the piano without scrolling. [See the score](https://s9.imslp.org/files/imglnks/usimg/1/14/IMSLP61906-PMLP02312-Chopin-Op09n2rje.pdf).

Prefer the smaller layout? Select **Classic** for A S D F G H J K on the white keys and W E T Y U on the black keys. **[ / ]** or the − / + buttons move either layout down or up an octave. The displayed range tells you where you are.

Same melody. Your own little voice-instrument. ♡

### 4. Get a little weird with it

Open **Shape the sound** and move a few sliders. Some changes make the instrument softer; others make it brighter or buzzier. Click a slider’s number to lock it, then train again and hear what happens when the synth has to work around your choices.

**Reset to simple tone** gives you a fresh starting sound. **Save instrument** downloads your sound recipe as JSON, without your recording. Loading saved recipes back into the app isn’t supported yet.

## If it doesn’t sound right

- **Too quiet?** Move closer to the microphone and hold the note a little louder.
- **Can’t find a note?** Try a steady “ooo” without talking or whispering.
- **No sound?** Check your volume, then click **Hear instrument** or a piano key.
- **Still sounds like the old instrument?** After selecting a sample, press **Train this sound** to teach it the new tone.

Meloform makes a synth inspired by the character of one vowel. It won’t repeat your words or sound exactly like a recording of you singing.

## How Handwired helps

Think of the synth as a recipe with 16 sound ingredients. Rust first measures those ingredients in your voice. Handwired turns the synth into a trainable program: it compares the sound it makes with your target and works out how much to change each ingredient. The piano then plays the learned recipe at different pitches.

## Run it on your computer

You’ll need Node.js 24+ and a stable Rust toolchain. There are no npm or Cargo packages to install.

```sh
rustup target add wasm32-unknown-unknown
npm run dev
```

Open http://127.0.0.1:5173. Microphone access works on localhost or a hosted HTTPS site. After editing the source, restart the dev command and reload the page.

## Publish with Cloudflare

Connect this GitHub repository to **Cloudflare Pages** and use:

- Production branch: `main`
- Framework preset: `None`
- Build command: `bash scripts/build-cloudflare.sh`
- Build output directory: `dist`

The repo selects Node.js 24 automatically. The build script installs Rust if needed, compiles the audio engine to WebAssembly, and builds the site. Future pushes to `main` deploy automatically. The app only serves static files; audio processing happens in the browser.

<details>
<summary>For the curious: code, tests, and what’s actually learning</summary>

### Where Rust and Handwired fit

- `crates/voice-dsp`: dependency-free Rust DSP compiled to `wasm32-unknown-unknown`. YIN-style pitch detection, Hann-windowed harmonic analysis, sample vowel construction, and reference waveform generation. A small raw WASM ABI handles float buffers; no wasm-bindgen required.
- `src/dsp.js`: memory-safe-at-the-call-site buffer ownership and WASM adapter.
- `src/model.js`: the actual Handwired `Circuit`. Sixteen trainable source cells mix sinusoidal basis functions into a 128-sample waveform. Squared error is computed inside that circuit. `backpropagateReference` supplies gradients for projected gradient descent; locked coefficients are skipped.
- `src/audio.js` / `src/recorder.js`: browser microphone capture and Web Audio playback. Playback uses the learned harmonic coefficients in a band-limited `PeriodicWave`, with a short attack/release and master compressor.
- `src/app.js`: interface, learning animation, locks, keyboard, and export.

Pitch detection is outside the learned circuit. The recording's harmonic magnitudes are reconstructed with aligned phases, so training matches harmonic character rather than the raw voice waveform. Rust's reference waveform is separately checked against Handwired's forward synthesis. CPU-only; no pretrained model, server inference, or audio upload.

### What the fit means

The displayed fit is `100 * (1 - sqrt(waveform MSE / target mean-square energy))`, clamped to 0–100%. Because both waveforms use the same orthogonal sine basis, it measures relative error in harmonic amplitudes. It is not a perceptual rating or voice-cloning score. The scope uses a shared display scale; listening uses normalized periodic waves.

This first experiment models a single steady vowel using 16 harmonics. It does not model breath, consonants, vibrato, changing formants, or speech. It estimates pitches from about 65–600 Hz. Sample vowels are synthetic. There is no claim that gradient descent is necessary for this simple linear fit: the point is to make Handwired's programmed-to-trainable transition visible and audible.

### Tests and static build

```sh
cargo test --manifest-path crates/voice-dsp/Cargo.toml
npm test
npm run build
```

`dist/` contains the static site, WASM binary, and transpiled Handwired runtime. Serve it with any static host over HTTPS. All asset URLs are relative, so subdirectory hosting works. `CARGO` can override the cargo executable. `PORT` can override the development server port.

Tests exercise pitch and harmonic recovery at multiple sample rates, rejection of silence/noise, actual WASM integration, agreement with Handwired's synthesis, convergence, and locked parameters. Automated synthetic audio tests do not replace testing your physical microphone.

A GitHub Actions template is included at `scripts/github-actions-check.yml`. Move it to `.github/workflows/check.yml` to enable CI using a credential with permission to manage workflows.

### Upstream attribution

The unmodified `vendor/handwired/numeric-ui-core.ts` is from [Cheng Lou's Handwired](https://github.com/chenglou/handwired), pinned at commit `4ea7fcb27ebe93acf49b9f29a93e162b975bad46`. Its MIT license is included beside it. Build uses Node's TypeScript stripping to create the browser module. Handwired remains JavaScript; this is a Rust DSP integration, not a Rust port of Handwired.

Audio remains in memory in your browser and is discarded on reload. Instrument exports contain only harmonic values and metadata. The interface currently requests fonts from Google Fonts; no audio is sent there.


</details>

## Design

Designed in [Paper](https://app.paper.design/file/01M511YCA2GD2YANWZ1WYSADVV), with a simple sing → train → play flow.
