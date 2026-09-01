/*
# Hospital OS — Sensor-Driven Patient Monitoring System (v2)

Redesigns the system from an algorithm-explanation tool into a real-time
patient monitoring + automated resource allocation platform. Sensors
attached to patients stream vital signs (heart rate, SpO2, blood pressure,
temperature, respiration). The system continuously evaluates these
readings against thresholds, auto-triages patients, and uses Banker's
Algorithm to safely allocate hospital resources (ICU beds, ventilators,
staff) when a patient's vitals cross into critical territory.

## New / Changed Tables

1. `sensors` — hardware sensors attached to patients (type, status, battery)
2. `sensor_readings` — time-series vital sign readings (one row per sensor pulse)
3. `patients` — extended with triage_level (auto-computed), assigned_ward, is_monitored
4. `resources` — unchanged (ICU beds, ventilators, etc.)
5. `allocations` — unchanged (Banker's matrix)
6. `simulation_logs` — unchanged (audit trail)
7. `memory_blocks` — kept for ward capacity tracking
8. `scheduling_results` — kept for history

## Security
- Single-tenant (no auth). RLS enabled, anon+authenticated full CRUD on all tables.
*/

-- ============================================================
-- SENSORS TABLE (hardware sensors attached to patients)
-- ============================================================
CREATE TABLE IF NOT EXISTS sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id text NOT NULL UNIQUE,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('heart_rate','spo2','blood_pressure','temperature','respiration','ecg')),
  label text NOT NULL,
  unit text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','alert','error')),
  battery int NOT NULL DEFAULT 100 CHECK (battery >= 0 AND battery <= 100),
  min_safe numeric NOT NULL DEFAULT 0,
  max_safe numeric NOT NULL DEFAULT 999,
  last_reading numeric,
  last_reading_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- SENSOR READINGS TABLE (time-series vital signs)
-- ============================================================
CREATE TABLE IF NOT EXISTS sensor_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id uuid NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  value numeric NOT NULL,
  is_alert boolean NOT NULL DEFAULT false,
  reading_time timestamptz DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;

-- Policies for sensors
DROP POLICY IF EXISTS "anon_crud_sensors_s" ON sensors;
CREATE POLICY "anon_crud_sensors_s" ON sensors FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_sensors_i" ON sensors;
CREATE POLICY "anon_crud_sensors_i" ON sensors FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_sensors_u" ON sensors;
CREATE POLICY "anon_crud_sensors_u" ON sensors FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_sensors_d" ON sensors;
CREATE POLICY "anon_crud_sensors_d" ON sensors FOR DELETE TO anon, authenticated USING (true);

-- Policies for sensor_readings
DROP POLICY IF EXISTS "anon_crud_readings_s" ON sensor_readings;
CREATE POLICY "anon_crud_readings_s" ON sensor_readings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_crud_readings_i" ON sensor_readings;
CREATE POLICY "anon_crud_readings_i" ON sensor_readings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_readings_u" ON sensor_readings;
CREATE POLICY "anon_crud_readings_u" ON sensor_readings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_crud_readings_d" ON sensor_readings;
CREATE POLICY "anon_crud_readings_d" ON sensor_readings FOR DELETE TO anon, authenticated USING (true);

-- Add triage columns to patients (idempotent)
DO $$ BEGIN
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS triage_level text DEFAULT 'green' CHECK (triage_level IN ('green','yellow','red'));
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_monitored boolean DEFAULT false;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS assigned_ward text;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone text;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact text;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS admitted_at timestamptz DEFAULT now();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Indexes for sensor queries
CREATE INDEX IF NOT EXISTS idx_sensors_patient ON sensors(patient_id);
CREATE INDEX IF NOT EXISTS idx_sensors_status ON sensors(status);
CREATE INDEX IF NOT EXISTS idx_readings_sensor ON sensor_readings(sensor_id);
CREATE INDEX IF NOT EXISTS idx_readings_patient ON sensor_readings(patient_id);
CREATE INDEX IF NOT EXISTS idx_readings_time ON sensor_readings(reading_time DESC);
