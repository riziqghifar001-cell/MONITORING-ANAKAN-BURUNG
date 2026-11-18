# Monitoring Suhu Anakan Burung Jalak Bali

Dashboard web antarmuka awal untuk sistem kontrol suhu brooder menggunakan **ESP32-S3 CAM** dan **Relay 4 Channel** (2 bohlam pemanas, 2 kipas pendingin).

## Endpoint yang Diharapkan dari ESP32-S3
- `GET /stream` — MJPEG stream kamera
- `GET /telemetry` — JSON `{"temp": 33.1, "hum": 62}`
- `GET /relay?ch=1..4&state=0|1` — kontrol status relay
