# Meloform

Make a whole new instrument with your voice! Sing a note, teach a synth your tone, then play a melody with your voice-instrument ♡

Inspired by [Handwired by Cheng Lou](https://github.com/chenglou/handwired).

[**Play Meloform →**](https://meloform-music.pages.dev/)

## Let’s make some music

### 1. Give it a little “ooo”

Click **Record my voice**, allow your microphone, and sing one comfortable note for two seconds. Try a hum, “ooo”, “aaa”, “eee”, or your own unusual voiced tone—hold the sound instead of saying a word. The vowel samples are examples, not categories your recording is sorted into. No perfect pitch needed!

You’ll see a countdown and a microphone meter while it listens. Your recording stays in your browser.

**No mic?** Click one of the sample vowels to hear it, then press **Train this sound**.

### 2. Teach it your sound

Learning starts automatically after recording. Give it a moment: Handwired is learning little pieces of your waveform, including their shape and texture. The piano unlocks when your **learned voice** is ready.

Click **Hear learned voice**, then play the piano. They use the same instrument. **Original recording** lets you compare it with what you sang—there’s no separate piano mode to choose.

Try recording “ooo”, then “aaa”, then “eee” on a similar note. They should make different instruments! You can also try a buzzy or slightly rough tone. The model keeps much more waveform detail than the old harmonic-only version, though it won’t perfectly capture every quality of a real voice.

Hold a key for a continuous sound. Short overlapping textures sustain the note instead of replaying your entire recorded phrase. Release the key to let it fade away.

**Keep my tone** adds experimental Handwired-learned correction for nearby notes. Toggle it and use **Try a higher note** to compare. Corrections are only kept when they improve a separate measured tone comparison; that measurement isn’t a guarantee that they sound better. Notes far from your original pitch can still sound less like you.

The waveform display compares one captured segment with its learned reconstruction. **16/16 segments** means learning finished, not “100% sounds like you.” Reloading the page or choosing a sample clears your recording.

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

Record another sound and make another instrument. Your hum, a bright “eee”, and a rough “aaa” each give the synth a different starting texture.

With the built-in sample vowels, **Shape the sound** opens 64 harmonic sliders. Move them to make the sample softer, brighter, or buzzier. Click a slider’s number to lock it, then train again. These controls belong to the simple sample synth; recorded voices use the richer texture model.

**Save learned voice** downloads the learned coefficients as JSON. Those coefficients can reconstruct your voice texture, so the file contains voice information. Tone-correction filters are not included. **Save synth recipe** saves the built-in sample synth’s harmonic settings. Importing saved files isn’t supported yet.

## If it doesn’t sound right

- **Too quiet?** Move closer and hold the sound a little louder.
- **Can’t find a note?** Start with a steady voiced sound; speech and whispers aren’t supported.
- **Piano greyed out?** Wait for voice learning to finish. If it failed or was paused, press **Learn my voice**.
- **No sound?** Check the volume and click **Hear learned voice** or a piano key.
- **Still sounds like the old sample?** After choosing a built-in vowel, press **Train this sound**.
- **Less like you on very high or low notes?** Start near the note you sang. One recording can’t tell the synth how you would naturally sing across the whole piano.

## How Handwired helps

For your recording, Handwired learns the frequency content **and phase** of 16 short waveform segments. This retains details the old 64-harmonic model threw away, including some noisy and irregular texture. It learns those coefficients from zero using its actual backpropagation engine. The piano reconstructs sound from the learned coefficients and overlaps the segments into a sustained note.

A second Handwired program learns small tone-correction filters for nearby pitches. The built-in vowel examples retain the simpler 64-harmonic learning demonstration. This is a programmed, trainable instrument—not a pretrained voice-cloning model. The richer model learns short examples of your sound rather than understanding your voice or generating speech.

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

- `crates/voice-dsp` / `src/dsp.js`: dependency-free Rust compiled to WebAssembly, with pitch detection, harmonic analysis, synthetic vowels, and a raw buffer ABI.
- `src/recorded-model.js`: a Handwired `Circuit` for each 1,024-sample voice segment. It learns 1,022 signed sine/cosine Fourier coefficients. The squared coefficient loss is equivalent to waveform squared error excluding DC and Nyquist. Actual `backpropagateReference` gradients update the coefficients from zero; inverse FFT renders only the learned weights.
- `src/recorded-worker.js`: learns 16 four-cycle segments off the audio thread. The interface rejects stale worker results when a recording changes and offers retry on failure.
- `src/voice-grains.js` / `src/sustain-processor.js`: local period tracking, phase alignment, bounded level matching, and two overlapping Hann-windowed segments. Segment selection varies instead of replaying the full phrase. Frequencies above 45% of the output sample rate are removed before transposition.
- `src/voice-tone.js`: another Handwired Circuit learns 20 bounded filter gains per nearby note using 48 smoothed spectral-envelope bands. Training and validation use separate parts of the recording. A filter must improve the held-out rendered envelope by at least 1% to be accepted. Accepted curves can filter the learned voice segments.
- `src/voice-tone-worker.js` / `src/voice-tone-trainer.js`: cancellable background learning for 25 semitone notes around the sung pitch.
- `src/model.js`: the simpler built-in-sample model, with 64 trainable harmonic amplitudes and a 256-sample waveform loss. Locked slider coefficients stay fixed.
- `src/voice-sample.js`: chooses a stable recorded region and calculates nearest-note tuning. The sustain renderer uses short interior segments; it does not loop this entire region.
- `src/audio.js` / `src/recorder.js`: microphone capture, shared preview/piano routing, attack and release, and master compressor.

Pitch detection and segment preparation are outside Handwired. Handwired supplies the differentiable losses and gradients; ordinary Fourier fitting could also solve this task. Audio stays in the browser, with no server inference or pretrained model.

### What learning preserves—and what it doesn’t

The recorded model retains short waveform detail, including phase and energy between harmonics. Synthetic regression tests verify distinct vowel spectra and reconstruction of noise and subharmonic roughness. They do not establish perceptual similarity for a person’s voice. Alignment, overlap, and transposition can alter the texture; speech, long expressive changes, and how someone would naturally sing other notes are not learned.

**Segments learned** is a completion count. For the built-in sample model only, the displayed fit is `100 * (1 - sqrt(waveform MSE / target mean-square energy))`, clamped to 0–100%. Neither measure is a voice-identity score. The tone-filter validation is performed on recorded PCM; applying its curve to reconstructed grains is an approximation and is not separately perceptually validated.

### Tests and static build

```sh
cargo test --manifest-path crates/voice-dsp/Cargo.toml
npm test
npm run build
```

`dist/` contains the static site, WASM binary, and transpiled Handwired runtime. Serve it with any static host over HTTPS. All asset URLs are relative, so subdirectory hosting works. `CARGO` can override the cargo executable. `PORT` can override the development server port.

Tests exercise pitch and harmonic recovery at multiple sample rates, rejection of silence/noise, actual WASM integration, agreement with Handwired's synthesis, convergence, and locked parameters. Tone-correction tests cover real backpropagation, held-out rendered spectral improvement across three artificial timbres and two sample rates, level matching, neutral-filter reconstruction, corrected/bypassed/out-of-range playback, and cancellation of stale learning jobs. Recorded-model tests also cover actual coefficient learning, vowel separation through piano rendering, retained noise and subharmonic texture, long sustain without phrase restarts or dropouts, and worklet release. Automated synthetic audio tests do not replace testing your physical microphone.

A GitHub Actions template is included at `scripts/github-actions-check.yml`. Move it to `.github/workflows/check.yml` to enable CI using a credential with permission to manage workflows.

### Upstream attribution

The unmodified `vendor/handwired/numeric-ui-core.ts` is from [Cheng Lou's Handwired](https://github.com/chenglou/handwired), pinned at commit `4ea7fcb27ebe93acf49b9f29a93e162b975bad46`. Its MIT license is included beside it. Build uses Node's TypeScript stripping to create the browser module. Handwired remains JavaScript; this is a Rust DSP integration, not a Rust port of Handwired.

Audio remains in memory in your browser and is discarded on reload. Sample synth recipes contain harmonic values and metadata. Learned voice exports contain coefficients from which short voice textures can be reconstructed; exporting is an explicit local download. The interface currently requests fonts from Google Fonts; no audio is sent there.


</details>

## Design

Designed in [Paper](https://app.paper.design/file/01M511YCA2GD2YANWZ1WYSADVV), with a simple sing → train → play flow.
