//! Dependency-free DSP kernel. Handwired handles learning; Rust handles sound analysis.
use std::f64::consts::PI;
pub const HARMONICS: usize = 64;
pub const WAVE_SAMPLES: usize = 256;
fn normalize(values: &mut [f32]) {
    let maximum = values.iter().copied().fold(0.00001_f32, f32::max);
    for v in values {
        *v = *v / maximum * 0.85;
    }
}
pub fn vowel(kind: u32, pitch: f32) -> [f32; HARMONICS] {
    let formants: [(f32, f32); 3] = match kind {
        1 => [(750., 250.), (1200., 280.), (2600., 450.)],
        2 => [(300., 140.), (2300., 350.), (3000., 450.)],
        _ => [(350., 150.), (800., 230.), (2200., 400.)],
    };
    let mut amplitudes = [0.; HARMONICS];
    for (h, a) in amplitudes.iter_mut().enumerate() {
        let f = (h + 1) as f32 * pitch;
        let peaks: f32 = formants
            .iter()
            .map(|(center, width)| (-0.5 * ((f - center) / width).powi(2)).exp())
            .sum();
        *a = (0.12 + peaks) / ((h + 1) as f32).powf(0.45);
    }
    normalize(&mut amplitudes);
    amplitudes
}
pub fn cycle(amplitudes: &[f32], samples: usize) -> Vec<f32> {
    (0..samples)
        .map(|s| {
            amplitudes
                .iter()
                .enumerate()
                .map(|(h, a)| {
                    *a as f64 * (2. * PI * (h + 1) as f64 * s as f64 / samples as f64).sin()
                })
                .sum::<f64>() as f32
        })
        .collect()
}
pub fn detect_pitch(samples: &[f32], sample_rate: f32) -> Option<(f32, f32)> {
    let stride = (sample_rate / 12000.).floor().max(1.) as usize;
    let rate = sample_rate / stride as f32;
    let x: Vec<f64> = samples
        .iter()
        .step_by(stride)
        .take(3072)
        .map(|x| *x as f64)
        .collect();
    if x.len() < 64 {
        return None;
    }
    let max_lag = ((rate / 65.) as usize).min(x.len() / 2 - 1);
    let min_lag = (rate / 600.) as usize;
    let size = x.len() - max_lag;
    let mut yin = vec![1.; max_lag + 1];
    let mut running = 0.;
    for lag in 1..=max_lag {
        let d: f64 = (0..size).map(|i| (x[i] - x[i + lag]).powi(2)).sum();
        running += d;
        yin[lag] = if running > 0. {
            d * lag as f64 / running
        } else {
            1.
        };
    }
    for mut lag in min_lag..max_lag.saturating_sub(1) {
        if yin[lag] < 0.15 {
            while lag < max_lag && yin[lag + 1] < yin[lag] {
                lag += 1;
            }
            let (a, b, c) = (
                yin[lag - 1],
                yin[lag],
                *yin.get(lag + 1).unwrap_or(&yin[lag]),
            );
            let denominator = a - 2. * b + c;
            let offset = if denominator != 0. {
                (0.5 * (a - c) / denominator).clamp(-0.5, 0.5)
            } else {
                0.
            };
            return Some((rate / (lag as f32 + offset as f32), (1. - b) as f32));
        }
    }
    None
}
#[derive(Debug)]
pub enum AnalysisError {
    Quiet,
    Unstable,
    Invalid,
}
pub struct Analysis {
    pub pitch: f32,
    pub confidence: f32,
    pub amplitudes: [f32; HARMONICS],
}
pub fn analyze(samples: &[f32], sample_rate: f32) -> Result<Analysis, AnalysisError> {
    if samples.len() < 1024
        || samples.len() > 768000
        || !(8000. ..=192000.).contains(&sample_rate)
        || samples.iter().any(|v| !v.is_finite())
    {
        return Err(AnalysisError::Invalid);
    }
    let energy: f64 = samples.iter().map(|x| (*x as f64).powi(2)).sum();
    if (energy / samples.len() as f64).sqrt() < 0.008 {
        return Err(AnalysisError::Quiet);
    }
    // Follow the local pitch instead of assuming a whole 170–190 ms frame is
    // perfectly periodic. Real voices drift, even during a "steady" vowel.
    let probe_length = (sample_rate * 0.06) as usize;
    if samples.len() < probe_length {
        return Err(AnalysisError::Unstable);
    }
    let hop = (sample_rate * 0.04) as usize;
    let mut frames = Vec::new();
    for start in
        ((sample_rate * 0.2) as usize..=samples.len().saturating_sub(probe_length)).step_by(hop)
    {
        let probe = &samples[start..start + probe_length];
        let rms =
            (probe.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / probe.len() as f64).sqrt();
        if rms < 0.008 {
            continue;
        }
        if let Some((pitch, confidence)) = detect_pitch(probe, sample_rate) {
            if confidence < 0.85 {
                continue;
            }
            // Six periods separate adjacent harmonics while following vibrato.
            let length = (6. * sample_rate / pitch).round() as usize;
            let center = start + probe_length / 2;
            let begin = center.saturating_sub(length / 2);
            if begin + length > samples.len() {
                continue;
            }
            let spectrum = harmonic_energy(&samples[begin..begin + length], sample_rate, pitch);
            frames.push((pitch, confidence, spectrum));
        }
    }
    frames.sort_by(|a, b| a.0.total_cmp(&b.0));
    let &(pitch, confidence, _) = frames
        .get(frames.len() / 2)
        .ok_or(AnalysisError::Unstable)?;
    // Discard octave mistakes and combine normalized spectra, so a loud attack
    // or a single wobbly frame cannot erase the voice's characteristic overtones.
    frames.retain(|frame| (frame.0 / pitch - 1.).abs() < 0.15);
    let mut amplitudes = [0.; HARMONICS];
    for (h, amplitude) in amplitudes.iter_mut().enumerate() {
        let mut values: Vec<f32> = frames.iter().map(|frame| frame.2[h]).collect();
        values.sort_by(f32::total_cmp);
        *amplitude = values[values.len() / 2];
    }
    normalize(&mut amplitudes);
    Ok(Analysis {
        pitch,
        confidence,
        amplitudes,
    })
}

fn harmonic_energy(samples: &[f32], sample_rate: f32, pitch: f32) -> [f32; HARMONICS] {
    let n = (samples.len() * 2).next_power_of_two();
    let mut real = vec![0.; n];
    let mut imaginary = vec![0.; n];
    let mean = samples.iter().map(|x| *x as f64).sum::<f64>() / samples.len() as f64;
    for (i, sample) in samples.iter().enumerate() {
        real[i] = (*sample as f64 - mean)
            * (0.5 - 0.5 * (2. * PI * i as f64 / (samples.len() - 1) as f64).cos());
    }
    // Radix-2 FFT. Integrate power around each harmonic, not just its exact
    // frequency: pitch motion spreads energy into nearby frequency bins.
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            real.swap(i, j);
            imaginary.swap(i, j);
        }
    }
    let mut size = 2;
    while size <= n {
        let angle = -2. * PI / size as f64;
        let (step_im, step_re) = angle.sin_cos();
        for start in (0..n).step_by(size) {
            let (mut wr, mut wi) = (1., 0.);
            for k in 0..size / 2 {
                let even = start + k;
                let odd = even + size / 2;
                let tr = wr * real[odd] - wi * imaginary[odd];
                let ti = wr * imaginary[odd] + wi * real[odd];
                real[odd] = real[even] - tr;
                imaginary[odd] = imaginary[even] - ti;
                real[even] += tr;
                imaginary[even] += ti;
                (wr, wi) = (wr * step_re - wi * step_im, wr * step_im + wi * step_re);
            }
        }
        size *= 2;
    }
    let mut amplitudes = [0.; HARMONICS];
    for bin in 1..n / 2 {
        let harmonic = (bin as f64 * sample_rate as f64 / n as f64 / pitch as f64).round() as usize;
        if (1..=HARMONICS).contains(&harmonic) {
            amplitudes[harmonic - 1] += (real[bin].powi(2) + imaginary[bin].powi(2)) as f32;
        }
    }
    for amplitude in &mut amplitudes {
        *amplitude = amplitude.sqrt();
    }
    normalize(&mut amplitudes);
    amplitudes
}
// Raw WASM ABI. JS owns the lifetime of all buffers; no wasm-bindgen dependency.
#[no_mangle]
pub extern "C" fn alloc_floats(len: usize) -> *mut f32 {
    Box::into_raw(vec![0.0_f32; len].into_boxed_slice()) as *mut f32
}
/// # Safety
/// ptr must be a live alloc_floats allocation of exactly len floats.
#[no_mangle]
pub unsafe extern "C" fn free_floats(ptr: *mut f32, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
/// # Safety
/// output must point to HARMONICS writable floats.
#[no_mangle]
pub unsafe extern "C" fn sample_vowel(kind: u32, pitch: f32, output: *mut f32) {
    std::slice::from_raw_parts_mut(output, HARMONICS).copy_from_slice(&vowel(kind, pitch));
}
/// # Safety
/// amplitudes must point to HARMONICS readable floats; output to WAVE_SAMPLES writable floats.
#[no_mangle]
pub unsafe extern "C" fn render_cycle(amplitudes: *const f32, output: *mut f32) {
    let rendered = cycle(
        std::slice::from_raw_parts(amplitudes, HARMONICS),
        WAVE_SAMPLES,
    );
    std::slice::from_raw_parts_mut(output, WAVE_SAMPLES).copy_from_slice(&rendered);
}
/// # Safety
/// input must point to len readable floats; output to HARMONICS + 2 writable floats.
#[no_mangle]
pub unsafe extern "C" fn analyze_voice(
    input: *const f32,
    len: usize,
    sample_rate: f32,
    output: *mut f32,
) -> u32 {
    match analyze(std::slice::from_raw_parts(input, len), sample_rate) {
        Ok(result) => {
            let out = std::slice::from_raw_parts_mut(output, HARMONICS + 2);
            out[0] = result.pitch;
            out[1] = result.confidence;
            out[2..].copy_from_slice(&result.amplitudes);
            0
        }
        Err(AnalysisError::Quiet) => 1,
        Err(AnalysisError::Unstable) => 2,
        Err(AnalysisError::Invalid) => 3,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovers_synthetic_vowel() {
        for rate in [44100., 48000.] {
            for pitch in [110., 196., 330.] {
                let target = vowel(1, pitch);
                let samples: Vec<f32> = (0..(rate as usize * 2))
                    .map(|i| {
                        target
                            .iter()
                            .enumerate()
                            .map(|(h, a)| {
                                0.12 * *a as f64
                                    * (2. * PI * (h + 1) as f64 * pitch as f64 * i as f64
                                        / rate as f64
                                        + h as f64 * 0.23)
                                        .sin()
                            })
                            .sum::<f64>() as f32
                    })
                    .collect();
                let result = analyze(&samples, rate).unwrap();
                assert!(
                    (result.pitch - pitch).abs() < 1.,
                    "{} vs {}",
                    result.pitch,
                    pitch
                );
                assert!(result
                    .amplitudes
                    .iter()
                    .zip(target)
                    .all(|(a, b)| (*a - b).abs() < 0.04));
            }
        }
    }
    #[test]
    fn rejects_bad_audio() {
        assert!(matches!(
            analyze(&vec![0.; 96000], 48000.),
            Err(AnalysisError::Quiet)
        ));
        assert!(matches!(
            analyze(&[f32::NAN; 1024], 48000.),
            Err(AnalysisError::Invalid)
        ));
    }
    #[test]
    fn sine_cycle_has_expected_quarters() {
        let mut weights = [0.; HARMONICS];
        weights[0] = 1.;
        let result = cycle(&weights, 128);
        assert!((result[32] - 1.).abs() < 1e-6);
        assert!((result[96] + 1.).abs() < 1e-6);
    }
}
