// 将均匀绿幕 PNG 转换为带透明通道的紧凑桌宠素材，并抑制边缘绿色溢色。
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const [, , inputArgument, outputArgument] = process.argv;

if (!inputArgument || !outputArgument) {
  console.error("用法：node scripts/remove-chroma.js <输入.png> <输出.png>");
  process.exit(1);
}

const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
const source = PNG.sync.read(fs.readFileSync(inputPath));

function pixelOffset(x, y, width = source.width) {
  return (y * width + x) * 4;
}

function sampleBorderKey() {
  const totals = [0, 0, 0];
  let samples = 0;
  const stride = Math.max(1, Math.floor(Math.min(source.width, source.height) / 180));

  function addSample(x, y) {
    const offset = pixelOffset(x, y);
    totals[0] += source.data[offset];
    totals[1] += source.data[offset + 1];
    totals[2] += source.data[offset + 2];
    samples += 1;
  }

  for (let x = 0; x < source.width; x += stride) {
    addSample(x, 0);
    addSample(x, source.height - 1);
  }

  for (let y = stride; y < source.height - 1; y += stride) {
    addSample(0, y);
    addSample(source.width - 1, y);
  }

  return totals.map((total) => total / samples);
}

function smoothStep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

const key = sampleBorderKey();
const keyGreenExcess = key[1] - Math.max(key[0], key[2]);
const opaqueGreenExcess = Math.max(22, keyGreenExcess * 0.14);
const transparentGreenExcess = Math.max(145, keyGreenExcess * 0.72);
let minX = source.width;
let minY = source.height;
let maxX = -1;
let maxY = -1;

for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
    const offset = pixelOffset(x, y);
    const red = source.data[offset];
    const green = source.data[offset + 1];
    const blue = source.data[offset + 2];
    const greenExcess = green - Math.max(red, blue);
    const matte = 1 - smoothStep(
      (greenExcess - opaqueGreenExcess) / (transparentGreenExcess - opaqueGreenExcess)
    );
    const alpha = Math.round(source.data[offset + 3] * matte);

    if (alpha > 0 && alpha < 255 && green > Math.max(red, blue)) {
      source.data[offset + 1] = Math.max(red, blue);
    }

    source.data[offset + 3] = alpha;

    if (alpha >= 8) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

if (maxX < minX || maxY < minY) {
  console.error("没有检测到前景主体，请检查绿幕颜色。");
  process.exit(1);
}

const padding = 12;
minX = Math.max(0, minX - padding);
minY = Math.max(0, minY - padding);
maxX = Math.min(source.width - 1, maxX + padding);
maxY = Math.min(source.height - 1, maxY + padding);

const cropped = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });

for (let y = 0; y < cropped.height; y += 1) {
  for (let x = 0; x < cropped.width; x += 1) {
    const sourceOffset = pixelOffset(minX + x, minY + y);
    const targetOffset = pixelOffset(x, y, cropped.width);
    source.data.copy(cropped.data, targetOffset, sourceOffset, sourceOffset + 4);
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, PNG.sync.write(cropped));
console.log(`透明素材已生成：${outputPath} (${cropped.width}×${cropped.height})`);
