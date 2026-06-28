# Makefile для расширения Recensio (Firefox MV3)
#
# Расширение собирается из TypeScript через esbuild (npm run build) в dist/,
# поэтому ВСЕ web-ext-цели работают с каталогом dist, а не с корнем репозитория.
# web-ext берётся из локальных devDependencies через npx — глобальная установка
# не нужна.
#
# Цели:
#   make build           — собрать расширение в dist/ (esbuild)
#   make watch           — esbuild в режиме watch (пересборка dist/ при сохранении)
#   make pack            — собрать .xpi в web-ext-artifacts/ (для ручной установки)
#   make sign            — подписать через AMO (channel=unlisted), для любого Firefox
#   make run             — web-ext run в одноразовом профиле (auto-reload по dist/)
#   make dev             — web-ext run в FIREFOX_PROFILE из .env (--keep-profile-changes)
#   make lint            — tsc --noEmit + web-ext lint dist/
#   make clean           — удалить артефакты сборки
#   make install-deps    — npm install (локальные зависимости, включая web-ext)
#   make help            — эта справка

-include .env
export

# .env читается как Makefile, а не как shell-скрипт. Если пользователь по
# привычке shell обернул FIREFOX_PROFILE в кавычки и/или экранировал пробелы
# (Application\ Support) — эти символы попадают в значение и ломают пути.
# Чистим: убираем все двойные/одиночные кавычки и backslash-перед-пробелом.
FIREFOX_PROFILE := $(subst ',,$(subst ",,$(FIREFOX_PROFILE)))
FIREFOX_PROFILE := $(subst \ , ,$(FIREFOX_PROFILE))

NAME      := recensio
EXT_ID    := recensio@local
DIST_DIR  := dist
SIGN_DIR  := web-ext-artifacts
WEB_EXT   := npx --no-install web-ext

# Дополнительные флаги web-ext, прокидываются в run/lint/sign/pack. Примеры:
#   make sign WEBEXT_FLAGS=--verbose                 — показать реальную причину ошибки
#   make sign WEBEXT_FLAGS=--api-proxy=http://host:port
# (нужно, если вы за прокси/VPN: Node fetch не читает HTTP(S)_PROXY из окружения)
WEBEXT_FLAGS ?=

.PHONY: help build watch pack sign run dev lint clean install-deps
.DEFAULT_GOAL := help

help:
	@echo "Targets:"
	@echo "  make build           — собрать расширение в $(DIST_DIR)/ (esbuild)"
	@echo "  make watch           — esbuild --watch (пересборка $(DIST_DIR)/ на сохранение)"
	@echo "  make pack            — собрать .xpi → $(SIGN_DIR)/ (для ручной установки в"
	@echo "                         Firefox Developer/Nightly/ESR с xpinstall.signatures.required=false)"
	@echo "  make sign            — подписать через AMO (channel=unlisted), ставится в любой Firefox"
	@echo "                         (берёт AMO_JWT_ISSUER / AMO_JWT_SECRET из .env)"
	@echo "  make run             — web-ext run в одноразовом профиле (перезагрузка при изменении $(DIST_DIR)/)"
	@echo "  make dev             — web-ext run в FIREFOX_PROFILE (из .env) с --keep-profile-changes;"
	@echo "                         для live-пересборки TS запустите 'make watch' в соседнем терминале"
	@echo "  make lint            — tsc --noEmit + web-ext lint $(DIST_DIR)/"
	@echo "  make clean           — удалить $(DIST_DIR)/ и $(SIGN_DIR)/"
	@echo "  make install-deps    — npm install"

build:
	npm run build

watch:
	npm run dev

pack: build
	@$(WEB_EXT) build --source-dir=$(DIST_DIR) --artifacts-dir=$(SIGN_DIR) --overwrite-dest
	@# web-ext build отдаёт .zip; Firefox для ручной установки ждёт .xpi
	@# (это тот же zip-контейнер). Переименовываем свежесобранный архив.
	@zip="$$(ls -t $(SIGN_DIR)/*.zip | head -1)"; \
		xpi="$${zip%.zip}.xpi"; mv -f "$$zip" "$$xpi"; \
		echo "Собрано: $$xpi ($$(du -h "$$xpi" | cut -f1))"
	@echo
	@echo "Установка (Firefox Developer Edition / Nightly / ESR):"
	@echo "  1) about:config → xpinstall.signatures.required = false"
	@echo "  2) Перетащить .xpi из $(SIGN_DIR)/ в окно Firefox"

sign: build
	@if [ -z "$$AMO_JWT_ISSUER" ] || [ -z "$$AMO_JWT_SECRET" ]; then \
		echo "AMO_JWT_ISSUER / AMO_JWT_SECRET не заданы в .env"; exit 1; \
	fi
	$(WEB_EXT) sign \
		--api-key="$$AMO_JWT_ISSUER" \
		--api-secret="$$AMO_JWT_SECRET" \
		--channel=unlisted \
		--source-dir=$(DIST_DIR) \
		--artifacts-dir=$(SIGN_DIR) \
		$(WEBEXT_FLAGS)
	@echo
	@echo "Подписанный .xpi лежит в $(SIGN_DIR)/"
	@echo "Его можно ставить в обычный Firefox (release/Beta) перетаскиванием в окно."

run: build
	$(WEB_EXT) run --source-dir=$(DIST_DIR) --browser-console $(WEBEXT_FLAGS)

lint: build
	npm run lint
	$(WEB_EXT) lint --source-dir=$(DIST_DIR) $(WEBEXT_FLAGS)

dev: build
	@if [ -z "$$FIREFOX_PROFILE" ]; then \
		echo "FIREFOX_PROFILE не задан. Добавьте в .env строку БЕЗ кавычек и без backslash-escape:"; \
		echo "  FIREFOX_PROFILE=$$HOME/Library/Application Support/Firefox/Profiles/xxxx.default-release"; \
		echo "Путь к рабочему профилю: about:profiles → 'Корневой каталог' основного профиля."; \
		echo "ВАЖНО: закройте Firefox с этим профилем перед запуском make dev."; \
		exit 1; \
	fi
	@if [ ! -d "$$FIREFOX_PROFILE" ]; then \
		echo "Каталог профиля не найден: $$FIREFOX_PROFILE"; exit 1; \
	fi
	$(WEB_EXT) run \
		--source-dir=$(DIST_DIR) \
		--firefox-profile="$$FIREFOX_PROFILE" \
		--keep-profile-changes \
		--browser-console

clean:
	rm -rf $(DIST_DIR) $(SIGN_DIR)

install-deps:
	npm install
