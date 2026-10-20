import { describe, expect, it } from 'vitest'
import { buildClipArgs, buildCompilationArgs, buildProbeArgs, planCompilation, sec } from './args'

const at = (args: string[], flag: string): number => args.indexOf(flag)
const slice = (args: string[], flag: string, n: number): string[] =>
  args.slice(at(args, flag), at(args, flag) + n)

describe('buildClipArgs', () => {
  const base = {
    input: 'C:\\видео\\матч; rm -rf.mp4',
    output: 'C:\\out\\a.mp4.part',
    start: 12.5,
    end: 20
  }

  it('точный режим: -ss и -t — параметры входа, строго до -i', () => {
    const a = buildClipArgs({ ...base, fast: false })
    expect(slice(a, '-ss', 6)).toEqual(['-ss', '12.500', '-t', '7.500', '-i', base.input])
    expect(at(a, '-ss')).toBeLessThan(at(a, '-i'))
    expect(at(a, '-t')).toBeLessThan(at(a, '-i'))
    expect(a).toContain('libx264')
    expect(slice(a, '-preset', 4)).toEqual(['-preset', 'veryfast', '-crf', '20'])
    expect(a).toContain('yuv420p')
    expect(slice(a, '-c:a', 4)).toEqual(['-c:a', 'aac', '-b:a', '160k'])
    expect(slice(a, '-movflags', 2)).toEqual(['-movflags', '+faststart'])
    expect(a).toContain('0:a:0?')
    expect(a[a.length - 1]).toBe(base.output)
    expect(a).not.toContain('copy')
  })

  it('быстрый режим: копирование потоков, без перекодирования', () => {
    const a = buildClipArgs({ ...base, fast: true })
    expect(slice(a, '-c', 2)).toEqual(['-c', 'copy'])
    expect(slice(a, '-avoid_negative_ts', 2)).toEqual(['-avoid_negative_ts', 'make_zero'])
    expect(a).not.toContain('libx264')
    expect(at(a, '-ss')).toBeLessThan(at(a, '-i'))
  })

  it('имя файла — один отдельный аргумент, оболочка не нужна; ход работы идёт в stdout', () => {
    const a = buildClipArgs({ ...base, fast: false })
    expect(a.filter((x) => x === base.input)).toHaveLength(1)
    expect(slice(a, '-progress', 2)).toEqual(['-progress', 'pipe:1'])
    expect(a).toContain('-nostats')
    expect(a).toContain('-nostdin')
  })
})

describe('планирование подборки', () => {
  const clips = [
    { start: 10, end: 12 },
    { start: 20, end: 21.5 }
  ]

  it('со звуком: split/asplit, trim+atrim, concat с v=1:a=1', () => {
    const plan = planCompilation(clips, true)
    expect(plan.inputs).toHaveLength(1)
    expect(plan.inputs[0].offset).toBe(10)
    expect(plan.inputs[0].span).toBeCloseTo(11.5)
    expect(plan.script).toContain('[0:v]split=2[sv0][sv1]')
    expect(plan.script).toContain('[0:a]asplit=2[sa0][sa1]')
    expect(plan.script).toContain('[sv0]trim=start=0.000:end=2.000,setpts=PTS-STARTPTS[tv0]')
    expect(plan.script).toContain('[sa1]atrim=start=10.000:end=11.500,asetpts=PTS-STARTPTS[ta1]')
    expect(plan.script).toContain('[tv0][ta0][tv1][ta1]concat=n=2:v=1:a=1[cv][outa]')
    expect(plan.script).toContain('[cv]scale=trunc(iw/2)*2:trunc(ih/2)*2[outv]')
  })

  it('без звука: нет atrim и аудиовыхода', () => {
    const plan = planCompilation(clips, false)
    expect(plan.script).not.toContain('atrim')
    expect(plan.script).not.toContain('asplit')
    expect(plan.script).toContain('[tv0][tv1]concat=n=2:v=1:a=0[cv]')
    expect(plan.script).not.toContain('[outa]')
  })

  it('один эпизод: без split', () => {
    const plan = planCompilation([{ start: 5, end: 6 }], true)
    expect(plan.script).not.toContain('split')
    expect(plan.script).toContain('[0:v]trim=start=0.000:end=1.000')
    expect(plan.script).toContain('concat=n=1:v=1:a=1')
  })

  it('далёкие эпизоды — отдельные входы с быстрой перемоткой, пропущенное не читается', () => {
    const far = [
      { start: 100, end: 110 },
      { start: 105, end: 108 }, // внутри первого куска
      { start: 4000, end: 4010 }
    ]
    const plan = planCompilation(far, true)
    expect(plan.inputs).toEqual([
      { offset: 100, span: 10 },
      { offset: 4000, span: 10 }
    ])
    // Первый кусок делится между двумя эпизодами, второй — один эпизод без split.
    expect(plan.script).toContain('[0:v]split=2[sv0][sv1]')
    expect(plan.script).toContain('[sv1]trim=start=5.000:end=8.000,setpts=PTS-STARTPTS[tv1]')
    expect(plan.script).toContain('[1:v]trim=start=0.000:end=10.000,setpts=PTS-STARTPTS[tv2]')
    expect(plan.script).toContain('[1:a]atrim=start=0.000:end=10.000,asetpts=PTS-STARTPTS[ta2]')
    expect(plan.script).toContain('concat=n=3:v=1:a=1[cv][outa]')
    const a = buildCompilationArgs({
      input: 'in.mp4',
      output: 'o',
      scriptPath: 'g',
      plan,
      hasAudio: true
    })
    expect(a.filter((x) => x === '-i')).toHaveLength(2)
    expect(slice(a, '-ss', 6)).toEqual(['-ss', '100.000', '-t', '10.000', '-i', 'in.mp4'])
    expect(a.slice(a.indexOf('-i') + 2).slice(0, 6)).toEqual([
      '-ss',
      '4000.000',
      '-t',
      '10.000',
      '-i',
      'in.mp4'
    ])
  })

  it('аргументы: граф из файла, звук — только если он есть', () => {
    const plan = planCompilation(clips, true)
    const a = buildCompilationArgs({
      input: 'in.mp4',
      output: 'out.mp4.part',
      scriptPath: 'g.txt',
      plan,
      hasAudio: true
    })
    expect(slice(a, '-ss', 6)).toEqual(['-ss', '10.000', '-t', '11.500', '-i', 'in.mp4'])
    expect(slice(a, '-filter_complex_script', 2)).toEqual(['-filter_complex_script', 'g.txt'])
    expect(a).toContain('[outa]')
    const silent = buildCompilationArgs({
      input: 'in.mp4',
      output: 'out.mp4.part',
      scriptPath: 'g.txt',
      plan: planCompilation(clips, false),
      hasAudio: false
    })
    expect(silent).not.toContain('[outa]')
    expect(silent).not.toContain('aac')
  })

  it('граф на 500 эпизодов лежит в файле, а командная строка короткая', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ start: i * 10, end: i * 10 + 5 }))
    const plan = planCompilation(many, true)
    const a = buildCompilationArgs({
      input: 'in.mp4',
      output: 'o',
      scriptPath: 'g',
      plan,
      hasAudio: true
    })
    expect(a.join(' ').length).toBeLessThan(1000)
    expect(plan.script.length).toBeGreaterThan(10_000)
  })
})

describe('прочее', () => {
  it('sec: три знака, не отрицательное', () => {
    expect(sec(1)).toBe('1.000')
    expect(sec(-0.2)).toBe('0.000')
    expect(sec(83.12345)).toBe('83.123')
  })
  it('buildProbeArgs', () => {
    expect(buildProbeArgs('a.mp4')).toEqual(['-hide_banner', '-nostdin', '-i', 'a.mp4'])
  })
})
