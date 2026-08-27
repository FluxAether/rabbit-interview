import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const landingDir = dirname(fileURLToPath(import.meta.url))

export default {
  plugins: [
    tailwindcss({ config: join(landingDir, 'tailwind.config.js') }),
    autoprefixer(),
  ],
}
