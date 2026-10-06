# Интеграция с системами завода

Типичная интеграция с 1С:MES/QLS/WMS: конкретная выгрузка настраивается со специалистами завода. Ниже — точка входа двойника и способы подключения. Полное описание:

- **REST** — Swagger UI: `http://<хост>/docs`, спецификация: `/docs/json` (генерируется из Zod-схем, копия: `packages/contracts/openapi.json`);
- **MQTT** — `http://<хост>/asyncapi`, исходник: `packages/contracts/asyncapi.yaml`;
- **примеры сообщений** — `packages/contracts/examples/`.

Все сообщения проверяются схемой. Ошибки возвращаются по-русски с указанием поля и видны на экране «Источники данных». Повтор с тем же `eventId` не создаёт дубль, поэтому 1С может безопасно повторять отправку. Время — ISO 8601 с часовым поясом, завод работает по UTC+5.

## 1С:MES, 1С:QLS, 1С:WMS, 1С:ERP

Два рабочих варианта:

1. **1С отправляет сама** (рекомендуем). HTTP-сервис или регламентное задание в 1С собирает изменения: проходы постов (регистр движения VIN), записи журнала простоев, несоответствия QLS, остатки WMS. Пакет отправляется в `POST /api/v1/events` раз в 5–30 секунд.
2. **Двойник забирает сам.** Опрос стандартного OData-интерфейса 1С (`/odata/standard.odata/…`) по отметке времени изменения. Это удобно, если доработку на стороне 1С делать не хотят.

| Что | Откуда в 1С | Адрес | Тип события |
|---|---|---|---|
| Проход кузова по посту | 1С:MES, движение VIN | `POST /api/v1/events` | `post_passed` |
| Простой | 1С:MES, журнал простоев | `POST /api/v1/downtimes` или `/events` | `downtime_registered` |
| Сменный отчёт | 1С:MES | `POST /api/v1/shift-reports` | `shift_report` |
| Несоответствие | 1С:QLS, журнал контроля | `POST /api/v1/events` | `nonconformity` |
| Итог качества | 1С:QLS | `POST /api/v1/quality` | `quality_summary` |
| Остатки комплектов | 1С:WMS | `POST /api/v1/events` | `stock_level` |
| План месяца по моделям | 1С:ERP | `POST /api/v1/plan` | `plan_set` |
| Выданные таблицы файлом | любой источник | `POST /api/v1/import/csv` | по заголовкам |

### Примеры `curl`

```bash
# Пакет событий из 1С:MES/QLS
curl -X POST http://localhost:3000/api/v1/events \
  -H 'Content-Type: application/json' \
  --data-binary @packages/contracts/examples/rest/events_batch.json

# Простой с телефона мастера: сразу появится на экране руководителя
curl -X POST http://localhost:3000/api/v1/downtimes \
  -H 'Content-Type: application/json' \
  --data-binary @packages/contracts/examples/rest/downtime.json

# Выданные таблицы организаторов — двойник покажет найденные противоречия
curl -X POST http://localhost:3000/api/v1/import/csv \
  -H 'Content-Type: text/csv' \
  --data-binary @data/organizers/rabota_liniy.csv
```

> В Windows (Git Bash, cmd) кириллица, переданная прямо в командной строке, может испортиться. Отправляйте тело из файла (`--data-binary @файл.json`) или из PowerShell 7.

Пример ответа с ошибкой (проверяется каждое событие пакета, корректные принимаются):

```json
{
  "accepted": 1,
  "duplicates": 0,
  "rejected": [
    { "index": 0, "eventId": "bad-1", "issues": [
      { "path": "vin", "message": "VIN — 17 символов: латинские буквы (кроме I, O, Q) и цифры" }
    ] }
  ]
}
```

## Контроллеры оборудования (ступень 1)

Контроллеры (ABB IRC5/OmniCore, ПЛК окрасочных камер и конвейера) обычно отдают данные по **OPC UA**. Между ними и двойником ставится шлюз OPC UA → MQTT: Kepware, Node-RED с `node-red-contrib-opcua`, Ignition Edge или аналог. Он публикует изменения в брокер двойника:

| Топик | Сообщение |
|---|---|
| `allur/kst/{area}/{equipmentId}/state` | `{ "status": "run" \| "idle" \| "fault" \| "maintenance", "code": "E-2117", "text": "Обрыв приводной цепи", "ts": "…" }` |
| `allur/kst/{area}/{equipmentId}/counter` | `{ "cycles": 5641, "total": 48213, "ts": "…" }` |
| `allur/kst/{area}/{equipmentId}/telemetry` | `{ "metric": "filter_dp_pa" \| "motor_current_a" \| "vibration_mm_s", "value": 312, "ts": "…" }` |

`area`: `warehouse | weld | paint | assembly | qc | finished`. Коды оборудования — из справочника (`packages/contracts/src/plant.ts`): `ABB-01…ABB-04`, `BOOTH-01`, `BOOTH-02`, `CONV-03` и т.д. `clientId` клиента рекомендуется начинать с `plc-`, тогда двойник показывает, что контроллеры подключены.

```bash
# Пример с mosquitto_pub
mosquitto_pub -h localhost -p 1883 -i plc-test -t 'allur/kst/paint/BOOTH-02/telemetry' \
  -m '{"metric":"filter_dp_pa","value":312,"ts":"2026-10-07T13:36:00+05:00"}'
```

В облаке, где открыт только порт HTTPS, используйте MQTT поверх WebSocket: `wss://<хост>/mqtt`.

## Камеры (ступень 1)

RTSP-поток камеры поста → видеоаналитика: свой сервис на YOLO/OpenCV, Frigate, коммерческая VMS с детекторами → MQTT:

| Топик | Сообщение |
|---|---|
| `allur/kst/{area}/camera/{cameraId}/detection` | `{ "kind": "line_stopped" \| "queue" \| "post_empty", "value": 4, "clipUrl": "/media/clips/assembly-stop.mp4", "ts": "…" }` |

`clipUrl` — ссылка на 30-секундный фрагмент записи. Он показывается в панели участка как «Видео с поста». В прототипе роликов нет: положите файлы в `data/media/clips/` (например, `assembly-stop.mp4`, `paint-stop.mp4`), и они откроются вместо заглушки.

## Датчики на критичных узлах (ступень 2)

Ток и вибрация приводов (например, привода Конвейера-03) идут через тот же MQTT, `metric: motor_current_a | vibration_mm_s`. Достаточно токовых клещей и вибродатчика на двигатель с IoT-шлюзом. Двойник предупреждает о росте нагрузки до обрыва цепи.

## Наряды от двойника

Когда руководитель принимает решение, двойник публикует наряд в `allur/kst/twin/work-orders` (пример: `packages/contracts/examples/mqtt/work_order.json`). В реальном внедрении наряд забирает 1С:ТОиР или MES. Это делается подпиской на топик или HTTP-вебхуком, который настраивается в шлюзе.

## Порты и переменные окружения шлюза

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | 3000 | HTTP: интерфейс, REST, WebSocket `/ws`, MQTT поверх WS `/mqtt` |
| `MQTT_PORT` | 1883 | MQTT по TCP |
| `DB_PATH` | `data/twin.db` | файл SQLite |
| `SIMULATORS` | off | `on` — шлюз сам запускает имитаторы отдельным процессом (облако) |
| `START_SPEED` | 60 | скорость времени демо при старте |
| `START_STAGE` | 1 | ступень внедрения при старте |
| `START_SCENARIO` | live_day | сценарий при старте |
