// ============================================================================
// Sensor Simulation Engine
// Generates realistic vital sign readings with natural variation and
// occasional anomalies. Computes triage level from sensor readings.
// ============================================================================

import { Sensor, SensorReading, TriageLevel, Patient } from './supabase'
import { supabase } from './supabase'

export interface LiveReading {
  sensorId: string
  value: number
  isAlert: boolean
  timestamp: number
}

// Generate a realistic next reading for a sensor based on its type and current value
export function generateReading(sensor: Sensor): number {
  const lastVal = sensor.last_reading ?? (sensor.min_safe + sensor.max_safe) / 2
  const range = sensor.max_safe - sensor.min_safe
  const center = (sensor.min_safe + sensor.max_safe) / 2

  // Natural variation: small random walk around last value, pulled toward center
  const noise = (Math.random() - 0.5) * range * 0.08
  const reversion = (center - lastVal) * 0.1
  let next = lastVal + noise + reversion

  // 8% chance of anomaly (spike) for online sensors
  if (Math.random() < 0.08 && sensor.status !== 'offline') {
    const spikeDir = Math.random() < 0.5 ? -1 : 1
    const spikeMag = range * (0.15 + Math.random() * 0.25)
    next = lastVal + spikeDir * spikeMag
  }

  // Clamp to physically plausible ranges
  const hardMin = sensor.type === 'temperature' ? 30 : sensor.type === 'ecg' ? -5 : 0
  const hardMax = sensor.type === 'temperature' ? 42 : sensor.type === 'ecg' ? 5 : 250
  next = Math.max(hardMin, Math.min(hardMax, next))

  return Math.round(next * 10) / 10
}

// Determine if a reading is an alert (outside safe range)
export function isAlert(reading: number, sensor: Sensor): boolean {
  return reading < sensor.min_safe || reading > sensor.max_safe
}

// Compute triage level from all of a patient's sensor readings
export function computeTriage(
  readings: { sensor: Sensor; value: number }[],
): TriageLevel {
  let hasRed = false
  let hasYellow = false

  for (const { sensor, value } of readings) {
    const deviation = value < sensor.min_safe
      ? sensor.min_safe - value
      : value > sensor.max_safe
        ? value - sensor.max_safe
        : 0

    if (deviation === 0) continue

    const range = sensor.max_safe - sensor.min_safe
    const severity = deviation / range

    // Critical sensors (SpO2, heart_rate, ecg) trigger red at smaller deviations
    const criticalTypes = ['spo2', 'heart_rate', 'ecg']
    const threshold = criticalTypes.includes(sensor.type) ? 0.15 : 0.25

    if (severity > threshold || (sensor.type === 'spo2' && value < 90) || (sensor.type === 'heart_rate' && (value > 130 || value < 45))) {
      hasRed = true
    } else {
      hasYellow = true
    }
  }

  return hasRed ? 'red' : hasYellow ? 'yellow' : 'green'
}

// Triage color config
export const triageMeta: Record<TriageLevel, { label: string; color: string; bg: string; text: string }> = {
  green: { label: 'Stable', color: '#22c55e', bg: 'bg-success-100', text: 'text-success-700' },
  yellow: { label: 'Serious', color: '#f59e0b', bg: 'bg-warning-100', text: 'text-warning-700' },
  red: { label: 'Critical', color: '#ef4444', bg: 'bg-error-100', text: 'text-error-700' },
}

// ============================================================================
// Banker's Algorithm — for safe resource allocation when triage escalates
// ============================================================================
export interface BankerResource {
  id: string
  name: string
  total: number
  available: number
}

export interface BankerAllocation {
  patient_id: string
  patient_name: string
  patient_pid: number
  resource_id: string
  allocated: number
  max_need: number
}

export interface BankerResult {
  safe: boolean
  safeSequence: string[]
  steps: { patientName: string; workAfter: number[] }[]
  message: string
}

export function bankersAlgorithm(
  resources: BankerResource[],
  allocations: BankerAllocation[],
): BankerResult {
  const resourceIds = resources.map((r) => r.id)
  const n = resourceIds.length
  const available = resources.map((r) => r.available)

  const patientMap = new Map<string, BankerAllocation[]>()
  for (const a of allocations) {
    if (!patientMap.has(a.patient_id)) patientMap.set(a.patient_id, [])
    patientMap.get(a.patient_id)!.push(a)
  }

  const patientIds = Array.from(patientMap.keys())
  const m = patientIds.length

  const allocMatrix: number[][] = []
  const maxMatrix: number[][] = []
  for (const pid of patientIds) {
    const pa = patientMap.get(pid)!
    const ar = new Array(n).fill(0)
    const mr = new Array(n).fill(0)
    for (const a of pa) {
      const idx = resourceIds.indexOf(a.resource_id)
      if (idx >= 0) { ar[idx] = a.allocated; mr[idx] = a.max_need }
    }
    allocMatrix.push(ar)
    maxMatrix.push(mr)
  }

  const needMatrix = maxMatrix.map((row, i) => row.map((v, j) => v - allocMatrix[i][j]))
  const work = [...available]
  const finished = new Array(m).fill(false)
  const safeSequence: string[] = []
  const steps: BankerResult['steps'] = []

  let progress = true
  while (progress) {
    progress = false
    for (let i = 0; i < m; i++) {
      if (finished[i]) continue
      if (needMatrix[i].every((need, j) => need <= work[j])) {
        const pa = patientMap.get(patientIds[i])!
        const name = pa[0].patient_name
        for (let j = 0; j < n; j++) work[j] += allocMatrix[i][j]
        finished[i] = true
        safeSequence.push(name)
        steps.push({ patientName: name, workAfter: [...work] })
        progress = true
      }
    }
  }

  const safe = finished.every((f) => f)
  return {
    safe,
    safeSequence,
    steps,
    message: safe
      ? `SAFE — all patients can complete treatment. Sequence: ${safeSequence.join(' → ')}`
      : `UNSAFE — deadlock risk. Not all patients can complete treatment.`,
  }
}

// ============================================================================
// Generate + persist a batch of sensor readings and update triage
// ============================================================================
export async function pollSensors(
  sensors: Sensor[],
  patients: Patient[],
): Promise<{ readings: LiveReading[]; alerts: { sensor: Sensor; value: number; patient: Patient }[]; triageUpdates: { patientId: string; level: TriageLevel }[] }> {
  const readings: LiveReading[] = []
  const alerts: { sensor: Sensor; value: number; patient: Patient }[] = []
  const triageUpdates: { patientId: string; level: TriageLevel }[] = []

  // Group sensors by patient
  const byPatient = new Map<string, Sensor[]>()
  for (const s of sensors) {
    if (s.status === 'offline' || !s.patient_id) continue
    if (!byPatient.has(s.patient_id)) byPatient.set(s.patient_id, [])
    byPatient.get(s.patient_id)!.push(s)
  }

  const readingInserts: any[] = []
  const sensorUpdates: any[] = []

  for (const s of sensors) {
    if (s.status === 'offline' || !s.patient_id) continue
    const value = generateReading(s)
    const alert = isAlert(value, s)
    readings.push({ sensorId: s.id, value, isAlert: alert, timestamp: Date.now() })

    readingInserts.push({
      sensor_id: s.id,
      patient_id: s.patient_id,
      value,
      is_alert: alert,
      reading_time: new Date().toISOString(),
    })

    sensorUpdates.push({
      id: s.id,
      last_reading: value,
      last_reading_at: new Date().toISOString(),
      status: alert ? 'alert' : 'online',
      battery: Math.max(0, s.battery - (Math.random() < 0.3 ? 1 : 0)),
    })

    if (alert) {
      const patient = patients.find((p) => p.id === s.patient_id)
      if (patient) alerts.push({ sensor: s, value, patient })
    }
  }

  // Batch insert readings (keep DB lean — only insert if we have data)
  if (readingInserts.length > 0) {
    await supabase.from('sensor_readings').insert(readingInserts)
  }

  // Batch update sensors
  for (const su of sensorUpdates) {
    await supabase.from('sensors').update({
      last_reading: su.last_reading,
      last_reading_at: su.last_reading_at,
      status: su.status,
      battery: su.battery,
      updated_at: new Date().toISOString(),
    }).eq('id', su.id)
  }

  // Compute triage per patient
  for (const [patientId, patientSensors] of byPatient) {
    const sensorReadings = patientSensors.map((s) => ({
      sensor: s,
      value: readings.find((r) => r.sensorId === s.id)?.value ?? s.last_reading ?? 0,
    }))
    const triage = computeTriage(sensorReadings)
    triageUpdates.push({ patientId, level: triage })

    const patient = patients.find((p) => p.id === patientId)
    const currentTriage = patient?.triage_level || 'green'

    // If triage escalated, log it
    if (triage !== currentTriage && patient) {
      const severity = triage === 'red' ? 'error' : triage === 'yellow' ? 'warning' : 'success'
      await supabase.from('simulation_logs').insert({
        event_type: 'TRIAGE',
        event_message: `Patient ${patient.name} (PID ${patient.pid}) triage changed: ${currentTriage.toUpperCase()} → ${triage.toUpperCase()}`,
        severity,
        details: { patient_id: patientId, from: currentTriage, to: triage },
      })
    }

    await supabase.from('patients').update({
      triage_level: triage,
      updated_at: new Date().toISOString(),
    }).eq('id', patientId)
  }

  // Log alerts
  for (const { sensor, value, patient } of alerts) {
    const direction = value < sensor.min_safe ? 'below' : 'above'
    const threshold = value < sensor.min_safe ? sensor.min_safe : sensor.max_safe
    await supabase.from('simulation_logs').insert({
      event_type: 'ALERT',
      event_message: `${sensor.label} alert: ${patient.name} — ${value}${sensor.unit} (${direction} threshold ${threshold}${sensor.unit})`,
      severity: 'error',
      details: { patient_id: patient.id, sensor_id: sensor.id, value, threshold, direction },
    })
  }

  return { readings, alerts, triageUpdates }
}
