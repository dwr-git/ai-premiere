# AI Видео

Видеоредактор в браузере со встроенным ИИ-помощником: нелинейный монтаж, переходы, титры и субтитры, цвет,
звук и экспорт в MP4 — для коротких роликов. Работает целиком в браузере пользователя; на сервере нужны только
nginx и PHP (помощник и «Мои проекты»), модель — ваша (Ollama или OpenAI-совместимый сервер).

- Установка и настройка: [`studio/README.ru.md`](studio/README.ru.md); что нового: [`studio/CHANGES.ru.md`](studio/CHANGES.ru.md).
- Готовые сборки: Releases → «Сборка N» → `ai-premiere-build-N-….zip` (собирает `.github/workflows/studio.yml`).

Premiere Pro — товарный знак Adobe. AI Видео не связан с Adobe и работает с распространёнными форматами
видео, звука и обмена монтажом.

Основано на открытом проекте [FilmCraft](https://github.com/storytold/filmcraft) от команды ArtCraft
(MIT OR Apache-2.0; описание исходного проекта — [`docs/README-upstream.md`](docs/README-upstream.md)).
Знаки ArtCraft из этой копии удалены (`docs/brand/`), как требует их лицензия для изменённых версий.
Лицензии — `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`; ресурсы — `ATTRIBUTION.md`.
