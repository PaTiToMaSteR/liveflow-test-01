import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

function intEnv(name, defaultValue) {
  const raw = process.env[name]
  if (raw === undefined) {
    return defaultValue
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function loadFixtureSource(source) {
  if (source === "large") {
    return {
      current: JSON.parse(fs.readFileSync(path.join(projectRoot, "__tests__", "data", "large_current.json"), "utf8")),
      target: JSON.parse(fs.readFileSync(path.join(projectRoot, "__tests__", "data", "large_target.json"), "utf8")),
    }
  }

  if (source === "large_elixir") {
    return {
      current: JSON.parse(
        fs.readFileSync(path.join(projectRoot, "..", "sheet_ops_ex", "test", "data", "large_current.json"), "utf8")
      ),
      target: JSON.parse(
        fs.readFileSync(path.join(projectRoot, "..", "sheet_ops_ex", "test", "data", "large_target.json"), "utf8")
      ),
    }
  }

  throw new Error(`Unsupported SOURCE=${source}. Use 'large' or 'large_elixir'.`)
}

function maxNonNullId(...dimensions) {
  let maxId = 0
  for (const values of dimensions) {
    for (const value of values) {
      if (value !== null && value > maxId) {
        maxId = value
      }
    }
  }
  return maxId
}

function repeatDimensionIds(values, repeatCount, idOffset) {
  const repeated = []
  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
    const baseOffset = repeatIndex * idOffset
    for (const value of values) {
      repeated.push(value === null ? null : value + baseOffset)
    }
  }
  return repeated
}

function repeatFixture(fixture, repeatCount) {
  if (repeatCount <= 1) {
    return fixture
  }

  const columnOffset = maxNonNullId(fixture.current.columns, fixture.target.columns) + 1
  const rowOffset = maxNonNullId(fixture.current.rows, fixture.target.rows) + 1

  return {
    current: {
      columns: repeatDimensionIds(fixture.current.columns, repeatCount, columnOffset),
      rows: repeatDimensionIds(fixture.current.rows, repeatCount, rowOffset),
    },
    target: {
      columns: repeatDimensionIds(fixture.target.columns, repeatCount, columnOffset),
      rows: repeatDimensionIds(fixture.target.rows, repeatCount, rowOffset),
    },
  }
}

function formatByteSize(bytes) {
  return `${bytes} B (${(bytes / 1_000_000).toFixed(3)} MB, ${(bytes / 1024 / 1024).toFixed(3)} MiB)`
}

function main() {
  const source = process.env.SOURCE ?? "large"
  const repeatCount = intEnv("REPEAT", 8)
  const outDir = process.env.OUT_DIR ?? path.join(projectRoot, "bench", "generated")

  const setupStart = process.hrtime.bigint()
  const fixture = loadFixtureSource(source)
  const repeated = repeatFixture(fixture, repeatCount)
  const generationNs = process.hrtime.bigint() - setupStart

  fs.mkdirSync(outDir, { recursive: true })

  const prefix = `${source}_repeat_${repeatCount}`
  const currentPath = path.join(outDir, `${prefix}_current.json`)
  const targetPath = path.join(outDir, `${prefix}_target.json`)

  const currentJson = JSON.stringify(repeated.current)
  const targetJson = JSON.stringify(repeated.target)

  fs.writeFileSync(currentPath, currentJson)
  fs.writeFileSync(targetPath, targetJson)

  console.log(`Generated fixture '${prefix}'`)
  console.log(`  current: ${currentPath}`)
  console.log(`  target : ${targetPath}`)
  console.log(`  generationMs (load + repeat): ${(Number(generationNs) / 1_000_000).toFixed(3)} ms`)
  console.log(`  currentSize: ${formatByteSize(Buffer.byteLength(currentJson))}`)
  console.log(`  targetSize : ${formatByteSize(Buffer.byteLength(targetJson))}`)
  console.log(`  combined   : ${formatByteSize(Buffer.byteLength(currentJson) + Buffer.byteLength(targetJson))}`)
  console.log(
    `  lengths    : current(columns=${repeated.current.columns.length}, rows=${repeated.current.rows.length}), ` +
    `target(columns=${repeated.target.columns.length}, rows=${repeated.target.rows.length})`
  )
}

main()
