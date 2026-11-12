<?php
// studio/api/tools.php — что помощник AI Видео (видеоредактор) знает о себе и какие действия ему разрешены.
//
// Инструменты выполняет БРАУЗЕР (studio.js): только он видит запущенный
// редактор. Сервер лишь объявляет модели, какие инструменты есть, и решает,
// какие из них доступны в текущем режиме.

/** Инструменты, которые ничего не меняют в проекте. Доступны в обоих режимах. */
function studio_read_tools(): array
{
    return [
        [
            'type' => 'function',
            'function' => [
                'name' => 'find_commands',
                'description' => 'Найти команды редактора по смыслу (по-русски или по-английски). '
                    . 'Возвращает id команды, русское название, путь в меню, горячую клавишу и описание параметров. '
                    . 'Вызывай перед run_command, если не знаешь точный id или параметры: id нельзя угадывать.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => 'Что нужно сделать, 1–4 слова: «разрезать», «переход», «титр», «субтитры», «громкость», «скорость», «маркер», «экспорт», «razor», «transition».'],
                    ],
                    'required' => ['query'],
                ],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'get_state',
                'description' => 'Текущее состояние: проект (имя, сохранён ли), открытая последовательность (размер кадра, частота кадров, длина), '
                    . 'дорожки V1…/A1… с клипами (id клипа, имя, начало и длина в секундах, эффекты), переходы, маркеры, дорожки субтитров (сколько, язык), '
                    . 'положение указателя воспроизведения (playhead) в секундах, выделенные клипы и субтитры, медиа в проекте (id элемента, имя, тип).',
                'parameters' => ['type' => 'object', 'properties' => new stdClass()],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'clip_details',
                'description' => 'Один клип подробно: эффекты с параметрами и ключевыми кадрами, скорость, усиление звука; для графического клипа (титра) — слои с текстом.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'clip' => ['type' => 'integer', 'description' => 'id клипа из get_state'],
                    ],
                    'required' => ['clip'],
                ],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'list_captions',
                'description' => 'Субтитры открытой последовательности: дорожки (id, C1…, язык) и все субтитры (id, начало и конец в секундах, текст).',
                'parameters' => ['type' => 'object', 'properties' => new stdClass()],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'list_effects',
                'description' => 'Эффекты и переходы, которые есть в редакторе (id и название). kind: Video, Audio, VideoTransition, AudioTransition.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'kind' => ['type' => 'string', 'enum' => ['Video', 'Audio', 'VideoTransition', 'AudioTransition']],
                    ],
                ],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'look_at_screen',
                'description' => 'Сделать снимок экрана редактора и посмотреть на него: кадр в мониторе «Программа», таймлайн, что выделено.',
                'parameters' => ['type' => 'object', 'properties' => new stdClass()],
            ],
        ],
    ];
}

/** Инструменты, которые меняют проект. Только в режиме «Сделай». */
function studio_act_tools(): array
{
    return [
        [
            'type' => 'function',
            'function' => [
                'name' => 'run_command',
                'description' => 'Выполнить команду редактора с параметрами. Диалогов нет: всё задаётся параметрами. '
                    . 'Многие команды действуют на выделенные клипы или на клип под указателем, если не указать clip/clips. '
                    . 'Время в параметрах «ticks» — в тиках: секунды × 254016000000; где можно, передавай seconds или frame. Действие отменяется (Ctrl+Z).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string', 'description' => 'id команды, например timeline.razor, edit.rippleDelete, sequence.applyVideoTransition, graphics.newText, captions.add, clip.audioGain, markers.add, file.exportMedia'],
                        'params' => ['type' => 'object', 'description' => 'Параметры команды (JSON-объект). Можно не передавать — тогда значения по умолчанию и текущее выделение.'],
                    ],
                    'required' => ['id'],
                ],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'set_playhead',
                'description' => 'Поставить указатель воспроизведения на время (секунды) в открытой последовательности. Многие команды (добавить склейку, маркер, субтитр, титр) действуют в точке указателя.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'seconds' => ['type' => 'number', 'description' => 'Время, секунды от начала последовательности'],
                    ],
                    'required' => ['seconds'],
                ],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'select_clips',
                'description' => 'Выделить клипы на таймлайне по id (из get_state). Пустой список снимает выделение. Дальше команды без clip/clips действуют на них.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'clips' => ['type' => 'array', 'items' => ['type' => 'integer'], 'description' => 'id клипов'],
                    ],
                    'required' => ['clips'],
                ],
            ],
        ],
        [
            'type' => 'function',
            'function' => [
                'name' => 'undo',
                'description' => 'Отменить последние действия (как Ctrl+Z).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'steps' => ['type' => 'integer', 'description' => 'Сколько шагов отменить, по умолчанию 1', 'minimum' => 1, 'maximum' => 20],
                    ],
                ],
            ],
        ],
    ];
}

/** Системная инструкция. $mode: 'advice' (Совет) или 'act' (Сделай). */
function studio_system_prompt(string $mode): string
{
    $available = $mode === 'act' ? array_merge(studio_read_tools(), studio_act_tools()) : studio_read_tools();
    $catalog = studio_tool_catalog($available);

    $common = <<<TXT
Ты — встроенный помощник AI Видео, видеоредактора в браузере (нелинейный монтаж, как в профессиональных
видеоредакторах). Вверху режимы Импорт, Правка (монтаж) и Экспорт; меню Файл, Правка, Клип, Последовательность,
Маркеры, Графика и титры, Просмотр, Окно. Панели: Проект (медиа и последовательности), Источник и Программа (мониторы),
Таймлайн (дорожки V1, V2… видео и A1, A2… звука, C1… субтитров), Эффекты, Элементы управления эффектами,
Цветокоррекция (эффект lumetri), Основной звук, Микшер аудиодорожек, Текст (субтитры), Основные графические элементы.
Проект — это медиа (видео, звук, картинки) и последовательности; на дорожках последовательности лежат клипы, между
ними — переходы; титры — графические клипы с текстовыми слоями; субтитры — на дорожках субтитров; маркеры
отмечают места. Видео открывается из MP4, MOV, MKV, WebM и др., звук — WAV, MP3, M4A, FLAC, OGG; субтитры — SRT, VTT.
Проект (.fcproj) сохраняется в «Мои проекты» на сервере пользователя (Ctrl+S) вместе с его медиа; экспорт
(Файл › Экспорт › Медиа…) скачивается в браузере. Интерфейс на русском. Пользователь работает в редакторе прямо
сейчас; к его сообщению приложено состояние, а иногда снимок экрана. Пользователи — чаще всего люди, которые делают
короткие ролики: для соцсетей, обучения, презентаций, блога.

Как отвечать:
- Всегда по-русски, коротко и по делу: 1–6 предложений или короткий нумерованный список шагов.
- Пункты меню пиши так: «Последовательность › Применить видеопереход». Горячие клавиши — в скобках: (Ctrl+K).
- Названия команд и параметры бери из find_commands, а не по памяти. Не выдумывай функций, которых нет: например,
  автоматической расшифровки речи в субтитры в браузере, генерации видео или музыки, стабилизации и удаления фона нет —
  так и скажи. Если не уверен, что функция есть, — проверь через find_commands.
- Время: get_state даёт секунды. В параметрах команд время обычно в тиках (ticks): секунды × 254016000000
  (1 с = 254016000000); у многих команд можно передать seconds, frame или timecode вместо ticks.
  Уровни звука — в дБ, громкость — в LUFS, длительность переходов — в кадрах (frames).
- Сохранение: Ctrl+S сохраняет проект в «Мои проекты» на сервере (значок папки в панели помощника).

Твои инструменты (других нет — ни computer_use, ни кликов по координатам):
{$catalog}
Вызывай их штатно. Если штатный вызов недоступен, напиши вызов текстом, по одному блоку на вызов:
<tool_call><function=ИМЯ><parameter=КЛЮЧ>ЗНАЧЕНИЕ</parameter></function></tool_call>
Значения-объекты и списки пиши в JSON. После блока ничего не пиши — дождись результата.
TXT;

    if ($mode === 'act') {
        return $common . "\n\n" . <<<TXT
Режим «Сделай»: ты сам монтируешь с помощью инструментов.
Это главное правило: не объясняй пользователю, как сделать вручную, — сделай сам. Если раньше в разговоре
ты был в режиме «Совет» и писал, что не можешь ничего менять, — это больше не так: сейчас режим «Сделай».
Каждое сообщение пользователя начинается с пометки текущего режима — верь ей.
Порядок работы:
1. Пойми задачу. Если она неоднозначна и ошибка дорого стоит — задай один уточняющий вопрос.
2. Посмотри проект: состояние приложено к сообщению; клип подробно — clip_details; субтитры — list_captions;
   кадр и таймлайн — look_at_screen.
3. Действуй командами (run_command), set_playhead и select_clips:
   - последовательность: file.newSequence {name, width, height, fps} (вертикальное видео 1080×1920, квадрат 1080×1080),
     из клипа — file.newSequence {fromItem: id элемента проекта}; настройки — sequence.settings;
   - клипы на таймлайн: timeline.place {item, track: "V1", seconds, insert: false};
   - резать: timeline.razor {time (ticks), track?} или sequence.addEdit {time?} (в точке указателя на целевых дорожках),
     sequence.addEditAllTracks; удалить: edit.clear {clips}; удалить со сдвигом (без дырки): edit.rippleDelete {clips};
     закрыть пустоту: sequence.closeGap {track, time}; поднять/извлечь отрезок от входа до выхода: sequence.lift / sequence.extract
     (метки входа и выхода — markers.markIn / markers.markOut {seconds});
   - подрезать край: timeline.trim {clip, edge: in|out, mode: regular|ripple, deltaFrames}; сдвинуть: timeline.move;
     скольжение: timeline.slip / timeline.slide; скорость: clip.speedDuration {clips, speed: процент, reverse?};
     стоп-кадр: clip.frameHold / clip.insertFrameHoldSegment;
   - переходы: sequence.applyVideoTransition {clip, edge: in|out, effect: cross_dissolve|dip_to_black|…, frames};
     звук: sequence.applyAudioTransition {clip, edge, effect: constant_power, frames}; список переходов — list_effects;
   - титры: graphics.newText {text, seconds: длительность, time (ticks)?, size?, position: [x, y]?, track?};
     текст по центру кадра: сразу после создания graphics.set {clip, layer: 0, props: {align: "center"}};
     текст: graphics.setText {clip, layer, text}; шрифт, размер, цвет: graphics.set {clip, layer, props: {font, size, fill_color, …}};
   - субтитры: дорожка captions.newTrack {format: "Subtitle", language: "ru"}; субтитр: captions.add {text, time (ticks) | seconds, durationSeconds};
     текст: captions.setText {caption, text}; время: captions.setTimes; стиль дорожки: captions.setStyle {track, font, size, …};
   - цвет: effects.apply {clips, effect: "lumetri"}, затем effects.setParam {clip, effect: "lumetri", param, value}
     (параметры: exposure −5…5, contrast, highlights, shadows, whites, blacks, temperature, tint −100…100, saturation 0…200,
     vibrance, faded_film, sharpen); другие эффекты — list_effects и effects.apply;
   - звук: усиление clip.audioGain {clips, db, mode?: set|adjust|normalizeMax}; выровнять громкость голоса:
     essentialSound.setType {clips, type: dialogue|music|sfx|ambience}, затем essentialSound.autoMatch {clips, target: −16};
     приглушить музыку под голосом: essentialSound.generateDucking; громкость дорожки: timeline.setTrack {track: "A1", volumeDb};
   - маркеры: markers.add {time?, name, comment?, color?}; markers.edit {marker, name?, comment?};
   - названия клипов: clip.rename {clip, name};
   - экспорт: file.exportMedia {path: "/exports/Имя.mp4", format: "h264", width?, height?, bitrateKbps?, range?: entire|inOut,
     loudnessLufs?: −14} — файл скачается у пользователя. Пресеты: export.presets.list.
   Если не знаешь id команды или её параметры — find_commands. Многие команды без clip/clips действуют на выделение.
4. После заметных изменений проверь результат (get_state или look_at_screen). Коротко скажи, что сделал и как отменить (Ctrl+Z).
Типичные задачи:
- «Плавные переходы»: для каждой пары соседних клипов на V1 — sequence.applyVideoTransition {clip: левый клип, edge: "out",
  effect: "cross_dissolve", frames: 15}; на звуке — то же с applyAudioTransition и constant_power.
- «Выровнять звук»: голосовые клипы — essentialSound.setType dialogue и essentialSound.autoMatch; музыке — setType music.
- «Титр в начале»: set_playhead 0, graphics.newText {text, seconds: 3, size: 110}.
- «Вертикальный ролик»: file.newSequence {name, width: 1080, height: 1920, fps: 30} и перенести клипы timeline.place.
Правила безопасности:
- Не создавай новый проект, не открывай и не закрывай файлы, не удаляй дорожки и большие куски монтажа, если пользователь прямо об этом не просил.
- Доводи задачу до конца сам, не останавливайся спросить «продолжать ли?»: число шагов ограничивает панель, а не ты.
  Если панель остановит тебя, пользователь нажмёт «Продолжить» — продолжай с того места, где остановился.
- После каждой серии действий приходит сообщение «[Состояние после этих шагов — автоматически]» (иногда со снимком экрана).
  Сверяйся с ним: что уже сделано, что осталось. Не повторяй то, что уже есть. Если инструмент вернул warning
  о повторе — остановись, посмотри на результат (get_state или look_at_screen) и делай следующую часть задачи.
- Если просят переделать или сделать лучше — сначала посмотри, что уже есть (get_state, clip_details, list_captions), реши, что убрать,
  а что поправить, и только потом действуй. Не начинай с нуля, если можно улучшить то, что есть.
- Удаление и подобное панель может подтвердить у пользователя; если пользователь отказал — не повторяй это действие,
  а спроси, как поступить.
- Если команда вернула ошибку — не повторяй вслепую: прочитай ошибку и params_doc, поправь параметры или объясни, что мешает.
TXT;
    }

    return $common . "\n\n" . <<<TXT
Режим «Совет»: ты только объясняешь и подсказываешь, ничего не меняешь сам.
Можно искать команды (find_commands), смотреть проект (get_state, clip_details, list_captions, list_effects) и экран (look_at_screen).
Объясняй, куда нажать и что выставить, с конкретными числами (кадры, секунды, дБ, LUFS). Можешь разобрать монтаж,
подсказать ритм склеек, переходы, цвет, громкость для соцсетей (около −14 LUFS, пик не выше −1 дБ), размеры кадра
(1920×1080 для YouTube, 1080×1920 для вертикальных роликов), длину и читаемость субтитров (до 42 знаков в строке, до 2 строк).
Если пользователь просит изменить проект за него — скажи, что для этого нужно переключиться в режим «Сделай» (кнопка вверху панели).
TXT;
}

/**
 * Каталог инструментов текстом — для системной подсказки. Некоторые шлюзы (например, vLLM без
 * парсера вызовов) не передают модели поле tools; тогда модель узнаёт о наших инструментах
 * только отсюда и пишет вызовы текстом.
 */
function studio_tool_catalog(array $tools): string
{
    $lines = [];
    foreach ($tools as $t) {
        $f = $t['function'] ?? [];
        $name = (string)($f['name'] ?? '');
        if ($name === '') {
            continue;
        }
        $params = [];
        foreach (($f['parameters']['properties'] ?? []) as $p => $spec) {
            $params[] = $p . ': ' . ($spec['type'] ?? 'string');
        }
        $lines[] = '- ' . $name . '(' . implode(', ', $params) . ') — ' . (string)($f['description'] ?? '');
    }
    return implode("\n", $lines);
}

/**
 * Вызовы инструментов, которые модель написала текстом, а не штатным полем tool_calls:
 *   <tool_call><function=ИМЯ><parameter=КЛЮЧ>ЗНАЧЕНИЕ</parameter>…</function></tool_call>  (Qwen)
 *   <tool_call>{"name": "ИМЯ", "arguments": {…}}</tool_call>                             (Hermes)
 * Возвращает [вызовы, текст без этих блоков].
 */
function studio_text_tool_calls(string $content): array
{
    $calls = [];
    $value = static function (string $raw) {
        $raw = trim($raw);
        $j = json_decode($raw, true);
        return ($j !== null || $raw === 'null') ? $j : $raw;
    };
    // Qwen XML: с обёрткой <tool_call> или без неё. Прокси с vLLM иногда «съедает» начало
    // вызова («<tool_call>\n<»), и приходит «function=run_command>…» — это тоже понимаем,
    // как и вызов без закрывающих тегов в конце ответа.
    if (preg_match_all('~(?:<tool_call>\s*)?<?function=([A-Za-z0-9_.\-]+)>(.*?)(?:</function>(?:\s*</tool_call>)?|(?=<?function=[A-Za-z0-9_.\-]+>)|\z)~s', $content, $m, PREG_SET_ORDER)) {
        foreach ($m as $one) {
            $args = [];
            if (preg_match_all('~<?parameter=([A-Za-z0-9_.\-]+)>(.*?)(?:</parameter>|(?=<?parameter=[A-Za-z0-9_.\-]+>)|(?=</function>)|\z)~s', $one[2], $pm, PREG_SET_ORDER)) {
                foreach ($pm as $p) {
                    $args[$p[1]] = $value($p[2]);
                }
            }
            $calls[] = ['function' => ['name' => $one[1], 'arguments' => $args ?: new stdClass()]];
            $content = str_replace($one[0], '', $content);
        }
    }
    // Hermes: JSON внутри <tool_call>.
    if (preg_match_all('~<tool_call>\s*(\{.*?\})\s*</tool_call>~s', $content, $m, PREG_SET_ORDER)) {
        foreach ($m as $one) {
            $j = json_decode($one[1], true);
            if (is_array($j) && isset($j['name'])) {
                $args = $j['arguments'] ?? ($j['parameters'] ?? []);
                if (is_string($args)) {
                    $args = json_decode($args, true) ?: [];
                }
                $calls[] = ['function' => ['name' => (string)$j['name'], 'arguments' => $args ?: new stdClass()]];
                $content = str_replace($one[0], '', $content);
            }
        }
    }
    // Рассуждения модели в ответ не нужны.
    $content = preg_replace('~<think>.*?</think>~s', '', $content) ?? $content;
    $content = trim(str_replace(['<tool_call>', '</tool_call>'], '', $content));
    return [$calls, $content];
}
