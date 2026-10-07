// OpenAPI 3.1 генерируется из Zod-схем (единый источник правды для валидации и документации).
import { z } from 'zod';
import './index';
import { loadExamples } from './examples';

type Json = Record<string, unknown>;

/** Схемы компонентов из глобального реестра Zod (всё, что помечено .meta({ id })) */
function componentSchemas(): Record<string, Json> {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    io: 'input',
    unrepresentable: 'any',
  }) as { schemas: Record<string, Json> };
  for (const s of Object.values(schemas)) clean(s);
  return schemas;
}

/** Убираем служебные поля JSON Schema и громоздкий regex дат — для Swagger это шум */
function clean(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const o = node as Json;
  delete o.$schema;
  delete o.$id;
  if (o.format === 'date-time') delete o.pattern;
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach(clean);
    else clean(v);
  }
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

function jsonBody(schemaId: string, examples?: Record<string, unknown>, description?: string) {
  return {
    required: true,
    description,
    content: {
      'application/json': {
        schema: ref(schemaId),
        ...(examples ? { examples: Object.fromEntries(Object.entries(examples).map(([k, v]) => [k, { value: v }])) } : {}),
      },
    },
  };
}

function ok(description: string, schemaId?: string) {
  return {
    description,
    ...(schemaId ? { content: { 'application/json': { schema: ref(schemaId) } } } : { content: { 'application/json': { schema: { type: 'object' } } } }),
  };
}

const bad = { description: 'Ошибка валидации (сообщения по-русски)', content: { 'application/json': { schema: ref('ErrorResponse') } } };

export function buildOpenApiDocument(opts: { serverUrl?: string } = {}) {
  const ex = loadExamples();
  const events = ex.events;
  return {
    openapi: '3.1.0',
    info: {
      title: 'Цифровой двойник цеха — точка входа',
      version: '1.0.0',
      description: [
        'Единая документированная точка входа двойника. По этим адресам ходят имитаторы 1С в прототипе и пойдут настоящие системы завода.',
        '',
        '- Все события проверяются схемой; ошибки сохраняются и видны на экране «Источники данных».',
        '- Повтор события с тем же `eventId` не создаёт дубль (идемпотентность).',
        '- Время — ISO 8601 с часовым поясом, завод работает по UTC+5.',
        '- Контроллеры и видеоаналитика подключаются по MQTT, см. «Документация MQTT (AsyncAPI)».',
        '',
        'Типичная интеграция с 1С:MES/QLS/WMS — HTTP-сервисы или OData; конкретная выгрузка настраивается со специалистами завода.',
      ].join('\n'),
    },
    servers: [{ url: opts.serverUrl ?? '/', description: 'Шлюз двойника' }],
    tags: [
      { name: '1С и мастер', description: 'Приём данных из 1С:MES, QLS, WMS, ERP и с телефона мастера' },
      { name: 'Импорт', description: 'Загрузка выданных таблиц с проверкой противоречий' },
      { name: 'Двойник', description: 'Чтение состояния, прогнозов, инцидентов и принятие решений' },
      {
        name: 'Конфигурация завода',
        description:
          'Состав цеха: участки по потоку, параллельные станции, оборудование и его подключение. Каждое применение — новая версия, откат возможен. После применения двойник, интерфейс (WebSocket, сообщение plant) и имитаторы (MQTT allur/kst/twin/plant-config) перестраиваются без перезапуска.',
      },
      { name: 'Демо', description: 'Управление демонстрацией. В реальном внедрении не используется' },
    ],
    paths: {
      '/api/v1/events': {
        post: {
          tags: ['1С и мастер'],
          summary: 'Пакет событий из 1С:MES / QLS / WMS',
          description: 'Массив канонических событий. Каждое проверяется отдельно: корректные принимаются, ошибочные возвращаются с причиной.',
          requestBody: jsonBody('EventBatch', { 'Проход поста и несоответствие': ex.rest.events_batch }),
          responses: { 200: ok('Итог приёма', 'IngestResult'), 400: bad },
        },
      },
      '/api/v1/plan': {
        post: {
          tags: ['1С и мастер'],
          summary: 'План на месяц по моделям (1С:ERP)',
          requestBody: jsonBody('PlanRequest', { 'План октября': ex.rest.plan }),
          responses: { 200: ok('Итог приёма', 'IngestResult'), 400: bad },
        },
      },
      '/api/v1/shift-reports': {
        post: {
          tags: ['1С и мастер'],
          summary: 'Сменный отчёт в формате выданной таблицы',
          description: 'Дата, Линия, План, Факт, Время работы (ч), Загрузка (%). Дата — ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.',
          requestBody: jsonBody('ShiftReportRequest', { 'Данные организаторов': ex.rest.shift_reports }),
          responses: { 200: ok('Итог приёма и найденные противоречия'), 400: bad },
        },
      },
      '/api/v1/downtimes': {
        post: {
          tags: ['1С и мастер'],
          summary: 'Регистрация простоя (1С:MES или мастер)',
          description: 'Если не указать from — простой начинается сейчас (по часам двойника). Событие сразу появляется на экране руководителя.',
          requestBody: jsonBody('DowntimeRequest', { 'Обрыв цепи на сборке': ex.rest.downtime }),
          responses: { 200: ok('Итог приёма', 'IngestResult'), 400: bad },
        },
      },
      '/api/v1/quality': {
        post: {
          tags: ['1С и мастер'],
          summary: 'Итог качества в формате выданной таблицы',
          requestBody: jsonBody('QualityRequest', { 'Данные организаторов': ex.rest.quality }),
          responses: { 200: ok('Итог приёма и найденные противоречия'), 400: bad },
        },
      },
      '/api/v1/import/csv': {
        post: {
          tags: ['Импорт'],
          summary: 'Импорт выданной таблицы файлом CSV',
          description:
            'Тело — текст CSV (разделитель «;», «,» или табуляция; десятичная запятая допустима). Тип таблицы определяется по заголовкам: работа линий, простои, качество, план по моделям. В ответе — найденные противоречия.',
          requestBody: {
            required: true,
            content: {
              'text/csv': {
                schema: { type: 'string' },
                example: 'Дата;Линия;План;Факт;Время работы, ч;Загрузка, %\n01.10.2026;Сварка-1;120;118;7,8;98',
              },
            },
          },
          responses: { 200: ok('Итог импорта и найденные противоречия'), 400: bad },
        },
      },
      '/api/v1/state': {
        get: { tags: ['Двойник'], summary: 'Текущий снимок двойника', responses: { 200: ok('Снимок: показатели, участки, буферы, инциденты') } },
      },
      '/api/v1/incidents': {
        get: { tags: ['Двойник'], summary: 'Инциденты с объяснением и вариантами решений', responses: { 200: ok('Список инцидентов') } },
      },
      '/api/v1/forecast': {
        get: {
          tags: ['Двойник'],
          summary: 'Прогноз плана месяца (коридор P10/P50/P90) и разложение потерь',
          responses: { 200: ok('Прогноз') },
        },
      },
      '/api/v1/vin/{vin}': {
        get: {
          tags: ['Двойник'],
          summary: 'Паспорт автомобиля: маршрут по постам и условия в момент прохода',
          parameters: [{ name: 'vin', in: 'path', required: true, schema: ref('Vin') }],
          responses: { 200: ok('Паспорт'), 404: { description: 'VIN не найден' } },
        },
      },
      '/api/v1/bodies': {
        get: {
          tags: ['Двойник'],
          summary: 'Кузова в цехе: где каждый, сколько на месте против нормы, вид по выполненным операциям, флаги',
          description:
            'Положение — по отметкам кузова (body_checkpoint): до станции, если её отмечают RFID или ПЛК, иначе — до участка с оценкой по норме времени. ' +
            'С параметром query — поиск по всем кузовам, которые знает двойник, включая уже принятые на склад готовой продукции: часть VIN (например, последние 6 знаков) или номера кузова.',
          parameters: [
            { name: 'query', in: 'query', required: false, schema: { type: 'string', minLength: 3 }, description: 'Часть VIN или номера кузова, не меньше 3 знаков: «004812», «B-048»' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, description: 'Сколько результатов вернуть (с query)' },
          ],
          responses: { 200: ok('Список кузовов'), 400: { description: 'Слишком короткий запрос поиска' } },
        },
      },
      '/api/v1/bodies/{id}': {
        get: {
          tags: ['Двойник'],
          summary: 'Кузов по номеру или VIN: маршрут операций, история отметок, восстановленные отметки и петли перекраски',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Номер кузова (B-04812) или VIN' }],
          responses: { 200: ok('Кузов'), 404: { description: 'Кузов не найден' } },
        },
      },
      '/api/v1/sources': {
        get: { tags: ['Двойник'], summary: 'Состояние источников данных и ошибки валидации', responses: { 200: ok('Источники') } },
      },
      '/api/v1/decisions': {
        post: {
          tags: ['Двойник'],
          summary: 'Принять вариант решения по инциденту',
          description: 'Двойник выдаёт наряд в системы завода (MQTT allur/kst/twin/work-orders) и пересчитывает прогноз.',
          requestBody: jsonBody('DecisionRequest', { 'Заменить фильтр в пересменку': ex.rest.decision }),
          responses: { 200: ok('Решение принято, наряд выдан'), 400: bad, 404: { description: 'Инцидент или вариант не найден' } },
        },
      },
      '/api/v1/plant/config': {
        get: { tags: ['Конфигурация завода'], summary: 'Текущая применённая конфигурация (с живым состоянием связи)', responses: { 200: ok('Конфигурация', 'PlantConfig') } },
        put: {
          tags: ['Конфигурация завода'],
          summary: 'Применить новую версию',
          description: 'Проверяет и применяет. Версию, время и автора ставит шлюз. Нельзя удалить оборудование, по которому открыт инцидент.',
          requestBody: jsonBody('PlantConfigInput'),
          responses: { 200: ok('Применено: новая версия и список изменений'), 400: bad },
        },
      },
      '/api/v1/plant/config/versions': {
        get: { tags: ['Конфигурация завода'], summary: 'История версий', responses: { 200: ok('Версии, новые сверху') } },
      },
      '/api/v1/plant/config/validate': {
        post: {
          tags: ['Конфигурация завода'],
          summary: 'Проверка без применения',
          description: 'Ошибки (нельзя применить) и предупреждения — по-русски, с путём к участку, станции или оборудованию.',
          requestBody: jsonBody('PlantConfigInput'),
          responses: { 200: ok('Итог проверки', 'PlantValidation') },
        },
      },
      '/api/v1/plant/config/preview-impact': {
        post: {
          tags: ['Конфигурация завода'],
          summary: 'Влияние изменений без применения',
          description: 'Изменения человеческим языком, пропускная способность участков до и после, узкое место.',
          requestBody: jsonBody('PlantConfigInput'),
          responses: { 200: ok('Влияние', 'PlantImpact') },
        },
      },
      '/api/v1/plant/config/rollback/{ver}': {
        post: {
          tags: ['Конфигурация завода'],
          summary: 'Откат к версии',
          description: 'Создаёт новую версию — копию указанной. История остаётся линейной.',
          parameters: [{ name: 'ver', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
          responses: { 200: ok('Откат применён'), 400: bad, 404: { description: 'Версии нет в истории' } },
        },
      },
      '/api/v1/plant/config/export': {
        get: { tags: ['Конфигурация завода'], summary: 'Выгрузить текущую конфигурацию в JSON', responses: { 200: ok('Файл plant-config-vN.json', 'PlantConfig') } },
      },
      '/api/v1/plant/config/import': {
        post: {
          tags: ['Конфигурация завода'],
          summary: 'Загрузить конфигурацию из JSON и применить',
          requestBody: jsonBody('PlantConfigInput'),
          responses: { 200: ok('Применено'), 400: bad },
        },
      },
      '/api/v1/equipment/{id}/connection/test': {
        post: {
          tags: ['Конфигурация завода'],
          summary: 'Проверка подключения оборудования',
          description:
            'Имитатор (демо) опрашивается по-настоящему и возвращает живые значения. Для OPC UA, Modbus, S7 и SCADA — проверка адреса и попытка TCP-подключения с таймаутом; успешное подключение к несуществующему устройству не изображается.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: ref('EquipmentCode') }],
          requestBody: jsonBody('PlantConnectionInput'),
          responses: { 200: ok('Итог проверки', 'ConnectionTestResult'), 400: bad, 404: { description: 'Оборудования нет в применённой конфигурации' } },
        },
      },
      '/api/v1/equipment/{id}/connection': {
        put: {
          tags: ['Конфигурация завода'],
          summary: 'Сохранить подключение оборудования',
          description: 'Создаёт новую версию конфигурации. Статус «на связи» появится, когда по оборудованию реально придут данные.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: ref('EquipmentCode') }],
          requestBody: jsonBody('PlantConnectionInput'),
          responses: { 200: ok('Сохранено'), 400: bad, 404: { description: 'Оборудования нет в применённой конфигурации' } },
        },
      },
      '/api/v1/demo': {
        get: { tags: ['Демо'], summary: 'Состояние демонстрации: время, скорость, ступень, сценарий', responses: { 200: ok('Состояние') } },
      },
      '/api/v1/demo/clock': {
        post: {
          tags: ['Демо'],
          summary: 'Скорость и пауза',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { speed: { type: 'number' }, paused: { type: 'boolean' } } } } },
          },
          responses: { 200: ok('Состояние') },
        },
      },
      '/api/v1/demo/reset': { post: { tags: ['Демо'], summary: 'Сброс к началу сценария', responses: { 200: ok('Состояние') } } },
      '/api/v1/demo/scenario': {
        post: {
          tags: ['Демо'],
          summary: 'Запустить сценарий',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { scenario: { type: 'string' } }, required: ['scenario'] } } },
          },
          responses: { 200: ok('Состояние') },
        },
      },
      '/api/v1/demo/stage': {
        post: {
          tags: ['Демо'],
          summary: 'Ступень внедрения 0/1/2',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { stage: ref('Stage') }, required: ['stage'] } } },
          },
          responses: { 200: ok('Состояние') },
        },
      },
      '/api/v1/demo/simulate-all': {
        post: {
          tags: ['Демо'],
          summary: 'Имитировать данные со всего оборудования, не дожидаясь подключения',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] } } },
          },
          responses: { 200: ok('Состояние') },
        },
      },
    },
    components: {
      schemas: componentSchemas(),
      examples: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, { value: v }])),
    },
  };
}
