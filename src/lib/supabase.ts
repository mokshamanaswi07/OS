import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
})

export interface Resource {
  id: string
  name: string
  description: string | null
  total: number
  available: number
  unit: string
  category: string
  created_at: string
  updated_at: string
}

export interface Patient {
  id: string
  pid: number
  name: string
  age: number | null
  gender: string
  condition: string
  priority: number
  arrival_time: number
  burst_time: number
  waiting_time: number | null
  turnaround_time: number | null
  completion_time: number | null
  status: string
  ward: string
  memory_required: number
  triage_level: string
  is_monitored: boolean
  assigned_ward: string | null
  phone: string | null
  emergency_contact: string | null
  admitted_at: string
  created_at: string
  updated_at: string
}

export interface Sensor {
  id: string
  sensor_id: string
  patient_id: string | null
  type: string
  label: string
  unit: string
  status: string
  battery: number
  min_safe: number
  max_safe: number
  last_reading: number | null
  last_reading_at: string | null
  created_at: string
  updated_at: string
}

export interface SensorReading {
  id: string
  sensor_id: string
  patient_id: string | null
  value: number
  is_alert: boolean
  reading_time: string
}

export interface Allocation {
  id: string
  patient_id: string
  resource_id: string
  allocated: number
  max_need: number
  created_at: string
  updated_at: string
}

export interface SimulationLog {
  id: string
  event_type: string
  event_message: string
  details: any
  severity: string
  created_at: string
}

export interface MemoryBlock {
  id: string
  block_id: number
  label: string
  size: number
  used: number
  patient_id: string | null
  status: string
  strategy: string
  created_at: string
  updated_at: string
}

export type TriageLevel = 'green' | 'yellow' | 'red'

export const triageConfig: Record<TriageLevel, { label: string; color: string; bg: string; text: string; border: string }> = {
  green: { label: 'Stable', color: '#22c55e', bg: 'bg-success-100', text: 'text-success-700', border: 'border-success-300' },
  yellow: { label: 'Serious', color: '#f59e0b', bg: 'bg-warning-100', text: 'text-warning-700', border: 'border-warning-300' },
  red: { label: 'Critical', color: '#ef4444', bg: 'bg-error-100', text: 'text-error-700', border: 'border-error-300' },
}

export const sensorTypeConfig: Record<string, { icon: string; normalRange: [number, number]; unit: string; label: string }> = {
  heart_rate: { icon: '❤️', normalRange: [60, 100], unit: 'bpm', label: 'Heart Rate' },
  spo2: { icon: '🫁', normalRange: [95, 100], unit: '%', label: 'Blood Oxygen' },
  blood_pressure: { icon: '🩸', normalRange: [90, 140], unit: 'mmHg', label: 'Blood Pressure' },
  temperature: { icon: '🌡️', normalRange: [36.0, 37.5], unit: '°C', label: 'Temperature' },
  respiration: { icon: '💨', normalRange: [12, 20], unit: 'breaths/min', label: 'Respiration' },
  ecg: { icon: '📈', normalRange: [-2, 2], unit: 'mV', label: 'ECG' },
}
