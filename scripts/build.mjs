import { stripTypeScriptTypes } from 'node:module';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export const root = fileURLToPath(new URL('../', import.meta.url));
export async function build() {
  execFileSync(process.env.CARGO || 'cargo', ['build','--release','--target','wasm32-unknown-unknown','--manifest-path',root+'crates/voice-dsp/Cargo.toml'], { stdio:'inherit' });
  await mkdir(root + 'dist/vendor', { recursive: true });
  const code = await readFile(root + 'vendor/handwired/numeric-ui-core.ts', 'utf8');
  await writeFile(root + 'dist/vendor/numeric-ui-core.js', stripTypeScriptTypes(code));
  await cp(root + 'src', root + 'dist', { recursive: true });
  await cp(root + 'crates/voice-dsp/target/wasm32-unknown-unknown/release/voice_dsp.wasm', root + 'dist/voice_dsp.wasm');
  await cp(root + 'vendor/handwired/LICENSE', root + 'dist/vendor/LICENSE');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await build(); console.log('Built dist/'); }
