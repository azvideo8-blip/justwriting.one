import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// R7F-024 / R7F-028 / R7Q-030 / R7Q-029 — гигиена выкатки и ворот.
//
// Приватный ключ прода лежит в $RUNNER_TEMP с самого начала прогона: шаги «Типы»,
// «Тесты» и сборка (десятки минут) идут до первой команды, которая его читает, а
// любой шаг прогона — включая чужой код из `${{ }}`-подстановки — получает доступ
// к файлу. Ключ нужен только начиная с «Выкатки клиента», поэтому он пишется
// там же.
//
// Порядок шагов и условия запуска нельзя проверить ни типами, ни юнит-тестами
// кода — только чтением самих workflow. Здесь ровно то, что раньше держалось
// в голове человека, который правил YAML.
const root = process.cwd();
const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const gates = readFileSync(join(root, '.github/workflows/gates.yml'), 'utf8');

const stepAt = (name: string): number => deploy.indexOf(`- name: ${name}`);

describe('R7F-024: доступ к проду начинается вместе с выкаткой', () => {
  it('ключ пишется после сборки клиента и перед первой выкаткой', () => {
    expect(stepAt('Ключ доступа'), 'шаг «Ключ доступа» есть').toBeGreaterThan(-1);
    expect(stepAt('Ключ доступа'), 'ключ пишется ПОСЛЕ сборки клиента')
      .toBeGreaterThan(stepAt('Сборка клиента'));
    expect(stepAt('Ключ доступа'), 'ключ пишется ПЕРЕД выкаткой клиента')
      .toBeLessThan(stepAt('Выкатка клиента'));
  });

  it('ключ не переживает прогон и не остаётся в ~/.ssh', () => {
    expect(deploy).toMatch(/- name: Убрать ключ доступа/);
    expect(deploy).toMatch(/if: always\(\)/);
    expect(deploy).toMatch(/rm -f "\$RUNNER_TEMP\/deploy_key"/);
    expect(deploy).not.toMatch(/~\/\.ssh\/deploy_key/);
  });

  it('установщик браузера не просит root (R7F-024: `--with-deps` требует sudo)', () => {
    // Проверка по строкам команды, а не по всему файлу: в комментариях этот флаг
    // помянут словами, и запретить упоминание — значит заглушить гейт.
    const install = deploy.split('\n').filter(l => /^\s*run:.*playwright install/.test(l));
    expect(install.length, 'хотя бы один шаг ставит chromium').toBeGreaterThan(0);
    for (const line of install) expect(line, `шаг: ${line.trim()}`).not.toMatch(/--with-deps/);
    expect(deploy).toMatch(/playwright install chromium/);
  });

  it('выкатка идёт только из main и не берёт CI-прогон чужой ветки (R7Q-030)', () => {
    expect(deploy).toMatch(/if:\s*github\.ref == 'refs\/heads\/main'/);
    expect(deploy).toMatch(/event\s*===?\s*['"]push['"]/);
    expect(deploy).toMatch(/head_branch\s*===?\s*['"]main['"]/);
  });
});

describe('R7F-028: CI main-пуша не отменяется mid-run', () => {
  it('отмена в процессе — только для pull request', () => {
    expect(ci).toMatch(/cancel-in-progress:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}/);
  });
});

describe('R7Q-029: ворота по тегу — только если коммит тега на main', () => {
  it('тяжёлые ворота зависят от дешёвой проверки ancestors', () => {
    expect(gates).toMatch(/tag_on_main:/);
    expect(gates).toMatch(/--is-ancestor/);
    expect(gates).toMatch(/refs\/heads\/main:refs\/remotes\/origin\/main/);
    expect(gates).toMatch(/needs:\s*tag_on_main/);
    expect(gates).toMatch(/needs\.tag_on_main\.outputs\.run_gates == 'true'/);
  });

  it('проверка дёшевая: без Docker, с таймаутом и без установки зависимостей', () => {
    const job = gates.slice(gates.indexOf('  tag_on_main:'), gates.indexOf('  secrets_history:'));
    expect(job.length, 'джоб tag_on_main объявлен до остальных').toBeGreaterThan(0);
    expect(job).not.toMatch(/docker/i);
    expect(job).not.toMatch(/npm ci/);
    expect(job).toMatch(/timeout-minutes:/);
  });
});

// R7Q-035: три стендовые спеки на двух устройствах (e2e/*.stand.spec.ts, конфиг
// playwright.s38.config.ts) существовали только как ручная команда: ни в CI, ни
// в воротах их не запускал никто, и регресс слияния диалогов ловился постфактум.
describe('R7Q-035: стендовый набор двух устройств стоит в пайплайне', () => {
  const scriptPath = join(root, 'scripts/ci/s38-e2e.sh');

  it('ворота вызывают обёртку стендового прогона', () => {
    expect(gates).toMatch(/bash scripts\/ci\/s38-e2e\.sh/);
  });

  it('обёртка поднимает стенд, гасит его при любом исходе и оставляет след в журналах', () => {
    expect(existsSync(scriptPath), 'scripts/ci/s38-e2e.sh существует').toBe(true);
    const sh = readFileSync(scriptPath, 'utf8');
    expect(sh).toMatch(/bash scripts\/stand\/up\.sh/);
    expect(sh).toMatch(/trap cleanup EXIT/);
    expect(sh).toMatch(/bash scripts\/stand\/down\.sh/);
    expect(sh).toMatch(/playwright\.s38\.config\.ts/);
    // Каждый фоновый запуск обязан попасть в .pids стенда: down.sh читает
    // именно этот файл, а осиротевший node на :3604 держит порт, и следующий
    // подъём стенда падает на «порт занят».
    const lines = sh.split('\n');
    const backgrounded = lines
      .map((l, i) => ({ l, i }))
      .filter(x => /\s&\s*$/.test(x.l) && !/^\s*trap\b/.test(x.l));
    expect(backgrounded.length, 'в скрипте два фоновых процесса: заглушка и API').toBe(2);
    for (const { i, l } of backgrounded) {
      const after = lines.slice(i + 1, i + 3).join('\n');
      expect(after, `фоновый запуск «${l.trim().slice(0, 40)}…» не зарегистрирован в .pids`)
        .toMatch(/\$PIDS_FILE|scripts\/stand\/\.pids/);
    }
    // Прокси отвечает 502, пока API не поднялся: готовность считается по коду,
    // а не по факту «порт слушает».
    expect(sh).toMatch(/\/api\/healthcheck/);
  });

  it('порты обёртки не пересекаются с портами остальных шагов ворот и прода', () => {
    const sh = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';
    const ports = [...sh.matchAll(/:-(\d{4})\}/g)].map(m => m[1]!);
    const taken = new Set(['3000', '5439', '3100', '3010', '9999', '3003', '5440', '3300', '3310', '8999', '3013', '5442', '3304', '3305']);
    for (const p of ports) expect(taken.has(p), `порт ${p} занят другим шагом`).toBe(false);
    expect(ports.length, 'порты объявлены в скрипте').toBeGreaterThan(5);
  });

  // Спеки 0.9.29/0.9.28 работают против внешних сборок на :3101 и :3102
  // (отдельные клоны, пересобираемые под ключи этого подъёма). Без них спек 10
  // падает на ERR_CONNECTION_REFUSED, а serial-режим внутри файла снимает ещё
  // десять спеков — красные ворота из-за отсутствия фикстуры, что хуже
  // пропущенных трёх спеков. Обёртка обязана исключить их явно и сказать число.
  it('без старых клиентов обёртка исключает их три спека, а не краснеет', () => {
    const sh = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';
    expect(sh, 'адреса старых клиентов читаются из STAND_OLD_029').toMatch(/STAND_OLD_029/);
    expect(sh, 'и из STAND_OLD_028').toMatch(/STAND_OLD_028/);
    expect(sh, 'без обоих адресов спеки исключаются').toMatch(/--grep-invert/);
    expect(sh, 'паттерн исключения находит именно спеки 0.9.28 и 0.9.29')
      .toMatch(/0\\\.9\\\.2\[89\]/);
    expect(sh, 'исключение объявляется человеку в выводе')
      .toMatch(/echo "== старые клиенты не заданы/);
  });
});

// R7Q-031: выкатка не должна переключать трафик, если на сервере остались
// неприменённые миграции. Шаг написан ВЫКЛЮЧЕННЫМ: журнал миграций прода ещё не
// сверен (R7F-029), и включённые ворота валили бы каждую выкатку, а не ловили бы
// дефект. Проверка держит и это — если кто-то включит шаг раньше бэк-филла, тест
// красный.
describe('R7Q-031: ворота журнала миграций в выкатке', () => {
  const stepLine = /^\s*- name: Ворота журнала миграций \(R7Q-031\)/m;

  it('шаг есть и вызывает migrate.sh --status на сервере', () => {
    expect(deploy, 'в deploy.yml нет ворот журнала миграций').toMatch(stepLine);
    const at = deploy.search(stepLine);
    const body = deploy.slice(at, at + 1600);
    expect(body, 'шаг не спрашивает статус миграций').toMatch(/migrate\.sh --status/);
    expect(body, 'статус берётся на сервере, а не на раннере').toMatch(/\$DEPLOY_SSH/);
  });

  it('находка [PENDING] валит выкатку', () => {
    const at = deploy.search(stepLine);
    const body = deploy.slice(at, at + 1600);
    expect(body, 'нет проверки на [PENDING]').toMatch(/grep -q '.{0,2}PENDING/);
    expect(body).toMatch(/exit 1/);
  });

  // Ревью приёмки 0.10.0: `|| true` превращал отказ SSH или psql в пустой
  // STATUS — без строки [PENDING], то есть в «зелёные ворота». Ворота обязаны
  // требовать положительный ответ «Pending: 0», а не отсутствие плохого.
  it('ворота закрыты при отсутствии ответа (fail-closed)', () => {
    const at = deploy.search(stepLine);
    const next = deploy.indexOf('- name:', at + 10);
    const body = deploy.slice(at, next);
    expect(body, 'ошибка SSH/psql проглатывается').not.toMatch(/\|\|\s*true/);
    expect(body, 'нет требования «Pending: 0»').toMatch(/Pending: 0/);
  });

  it('шаг выключён до бэк-филла журнала и говорит почему', () => {
    const at = deploy.search(stepLine);
    const body = deploy.slice(at, at + 1600);
    expect(body, 'ворота включены раньше сверки журнала прода').toMatch(/if: false/);
    expect(deploy.slice(Math.max(0, at - 1500), at), 'нет объяснения, почему шаг выключен').toMatch(/R7F-029|бэк-филл/);
  });

  it('ворота стоят до переключения трафика клиента', () => {
    const gate = deploy.search(stepLine);
    const publish = deploy.search(/- name: Выкатка клиента/);
    expect(gate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(gate);
  });
});
