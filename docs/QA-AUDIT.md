# QA-аудит Brake It, Anton

Опубликованная база: `ce1f0206e39c4a743162b10a23ec74e322c938db` (`main` после иконки).
Ветка этого прохода: `cursor/title-jitter-qa-3e96`. Предыдущий коммит ветки: `c6e590671e87b1333dca568e7779daf14847e7e1`. Ветка не влита и на сайт не выкладывалась.
Телефон и сон остаются в PR https://github.com/SergeyDuvakin/brake-it-anton/pull/5 , коммит `296a164f385571046316ca0539e848012bcc816c`. В эту ветку не входили.

Этот текст заменяет короткий отчёт того же файла. Короткий отчёт принимал сдвиг всего титула за установленную причину и откладывал кипение декораций. Ниже разведены замер, гипотеза и то, чего среда не видела.

Среда замера: Node 22.23.4, Playwright 1.56.1, Chromium 141.0.7390.37, Playwright WebKit 26.0. Это headless-движки на Linux. Это не iPhone Safari и не Chrome на Android. Повторного просмотра записи ReplayKit в этом проходе не было. Грубый поиск сдвига по уменьшенной копии записи по-прежнему не является доказательством ни наличия, ни отсутствия движения на телефоне.

## Как читать причину записи

Запись владельца показывает титул, на котором вся картинка, включая кнопки, едет вместе, в основном вертикально, относительно полей. Это описание кадра. Оно не называет строку кода.

В `drawTitle` нет общего `ctx.translate` на мир и кнопки сразу. Ударная тряска `sim.shake` рисуется только в `drawPlay` и на титуле не вызывается. Поэтому сдвиг и дороги, и кнопки одним преобразованием холста в этом исходнике не найден. Сдвиг элемента `canvas` в странице такое движение объяснить может. То же движение могут дать прокрутка визуального вьюпорта, жест браузера, сам захват экрана. Какой из этих механизмов был на том iPhone, замер не установил.

`100vh` в разных версиях Safari и Chrome ведёт себя по-разному: где-то это большая вьюпорт-высота, где-то она уже динамическая. Формула старого CSS ниже показывает, куда уезжает центр, если подставленная высота меняется. Это свойство формулы. Это не замер, что высота на телефоне владельца менялась.

Синтетический прогон Playwright и физический телефон ниже не смешиваются. Исправление, которое стабилизирует формулу и пиксели в headless, не называется вылеченной записью.

## Что прочитано

По контуру, который просил владелец, прочитаны целиком `js/game.js`, `js/clock.js`, `js/viewport.js`, `js/session.js`, `js/missions.js`, `js/policies.js`, `js/rng.js`, `js/storage.js`, `js/audio.js`, `js/road.js`, `js/geom.js`, `style.css`, `index.html`. В `js/sim.js` прочитаны создание сессии, `commitHazards`, проекция опасностей, столкновение и шаг. В `js/draw.js` прочитаны титул, мир, декорации, машина и Антон. `js/physics.js` читался в части `safeSpeed`, `GEOMETRIC` и раздражения, не каждой вспомогательной функции.

Покупок, инвентаря, валюты и сетевого бэкенда в дереве нет. Для них статус N/A, это не найденные дыры.

## 1. Аварии, безопасность, эксплуатация

Подтверждённых дыр нет.

Сохранение — `localStorage`, ключ `brake-it-anton-save-v1`. `parseSave` в `js/storage.js` на порче JSON, чужой версии и `unlocked` вне 1…4 возвращает свежий профиль с одним открытым уроком. Юнит «victory unlocks the next lesson only, and a bad save does not unlock the game» это проверяет. `persist` глотает исключение записи, поездка при этом не падает. Секретов в клиенте нет. Сетевых запросов игрового состояния нет.

Непроверенный риск, серьёзность Низкая: правка `localStorage` на своём устройстве меняет только локальный прогресс этого браузера.

## 2. Игра, состояние, время, крайние случаи

### Инвариант времени. Статус: проверено, дефект не найден.

`frame` в `js/game.js` больше не держит арифметику у себя. Один кадр экрана отдаёт в симуляцию пачки шагов по 1/60 с. Стена режется до 0,1 с на кадр. При обычной скорости за кадр не больше 8 шагов, при `?e2e=1` (масштаб 6) не больше 48.

Стало, `js/clock.js`, функция целиком:

```javascript
export function drainFrame(acc, elapsedSeconds, timeScale = 1) {
  const raw = Math.min(0.1, elapsedSeconds);
  let next = acc + raw * timeScale;
  const cap = timeScale > 1 ? 48 : 8;
  let steps = 0;
  while (next >= 1 / 60 && steps < cap) {
    next -= 1 / 60;
    steps += 1;
  }
  return { acc: next, steps, raw };
}
```

Регрессия: `test/sim.test.js`, «display rate changes how many 1/60 steps land in a frame, not the step itself». Секунда стены на 30, 60, 90 и 120 Гц даёт 60 шагов ±1, остаток меньше одного шага. Пауза стены 0,5 с даёт `raw = 0,1` и 6 шагов, остальные 0,4 с не догоняются. Интерполяции между шагами нет: картинка показывает состояние после целого шага. Это юнит арифметики, не профиль герцовки телефона и не замер дрожания кадра на устройстве.

Пока сессия в `pause` или `result`, `sessionStep` возвращается сразу. Кадр продолжает списывать шаги, поэтому после паузы накопитель не выплёскивает длинный догон. Размытие окна и `document.hidden === true` ставят паузу и обнуляют педаль (`onBlur`, `onVisibility`, `clearControls`). Показ вкладки сам поездку не продолжает: нужен «Дальше». Юнит «pause, blur and hide clear the pedal and the held keys» это фиксирует. Позиция `s` за секунду паузы не меняется.

Повтор урока по-прежнему сразу в `drive`, обратный отсчёт только у новой сессии. Отдельного дефекта перехода титул → урок → результат → повтор в этом проходе не найдено. Прежние юниты и Playwright-сценарии повтора, раннего зазора и позднего удара зелёные.

### Физика и ранний/поздний тормоз. Статус: проверено прежними тестами, нового дефекта нет.

`stepSim` интегрирует скорость на шаге 1/60, затем `s += v * dt`, затем `collide` со старым `prevS`. `holdYield` для пешехода и выезжающей машины останавливает бампер за `yieldStandoff`, если скорость уже безопасная. Промах сквозь тело на большом шаге закрыт тестом «a large step cannot tunnel through a person». Ранний тормоз оставляет зазор больше 2 м и видимый зазор на 1280×720 и 844×390. Поздний тормоз у пешехода даёт столкновение. Это зелёные тесты на текущем дереве, не заезд на телефоне.

### Миссии, политики, seed. Прочитаны построчно.

Четыре урока в `LESSONS` рукописные. Seed урока (11, 22, 33, 44) в расстановку опасностей не входит: список фиксирован. `createSim` создаёт `mulberry32(seed)`, но `.rng()` в `js/` нигде не вызывается. `hashString` экспортируется и тоже нигде не вызывается. На повтор урока это не влияет: `restartSession` берёт тот же объект миссии и тот же seed, опасности уже лежат в массиве.

Проверено скриптом на seeds `0`, `1`, `4`, `9`, `-1`, `2^32`, `89999`:

- `buildInfinite(seed)` дважды даёт тот же список `s/type/trust/x`.
- `seed 2^32` совпадает с `seed 0`, потому что `seed >>> 0`.
- Соседние типы не повторяются (`repeats: 0`).
- Минимальный зазор на этих seeds 120…124 м. В коде пол `Math.max(108, ...)`. Телеграф по умолчанию 72 м, поэтому следующий телеграф начинается, когда предыдущая опасность уже позади больше чем на `clearAfter` (8 м).
- Первая бесконечная опасность на `s = 150`. Уроки открываются опасностью на 46…50 м, внутри обзора 72 м. Бесконечный режим так не открывается. Это различие авторства, не найденный сбой расстановки.
- Все `x` равны 1,8. Две опасности не стоят в разных полосах одновременно.

Окна уроков. Для каждой опасности посчитано `s - telegraph` и `s + clearAfter` предыдущей. Перекрытия нет: телеграф следующей начинается после точки, где предыдущую уже можно снять. Первый телеграф у каждого урока включается до старта (`showAt` от −28 до −22), опасность видна с первого кадра. Это совпадает с комментарием в `missions.js` и с юнитом «opens in view».

Политики, весь файл `js/policies.js`:

- `policyNever` не жмёт. На человеке в полосе это удар. Юнит это проверяет.
- `policyAlways` держит педаль.
- `policyCareful` не трогает `trust`. Окно 30 м для пешехода, 52 для выезда, 34 для крышки, 36 иначе, 78 на мокром. Мокрая зона урока 4 (`s` 18…210) накрывает пешехода на 50 и выезд на 148. Собака на 240 и яма на 330 уже сухие.
- `policyYield` тормозит не-trust ближе 40 м, пока скорость выше 1,2 м/с, и отпускает выползших.
- `policyProvoke` жмёт только при дистанции (44, 52). Это внутри окна решения trust `(commit 40, decision 58)`. Юнит «not braking a trust hazard is the better choice» это ловит.
- `policyPanic` жмёт 0,2 с из каждых 0,62 с по `sim.t`. Для торта это проигрыш груза. Юнит это проверяет.

Живой бесконечный заезд берёт seed `(Date.now() % 90000) + 1`. Повтор того же заезда сохраняет seed сессии, дорога не пересобирается.

### Припаркованная машина без trust в бесконечном режиме. Серьёзность: Средняя для бесконечного режима. В четырёх уроках такой машины нет. Статус: подтверждено, в этом коммите не менялось.

Единственная рукописная `stopped` — урок 3, `trust: true`. В `buildInfinite` собака и яма всегда trust, стоящая машина trust только если следующий `rng() > 0.45`. На seed 1 таких машин без trust шесть из девяти.

`stopped` входит в `GEOMETRIC`, поэтому ветка «уже медленный, значит уступил» для неё не берётся, хотя `SAFE_SPEED.stopped` равен 99. Игрок руль не крутит. `policyCareful` для неё почти никогда не жмёт: порог `safe - 0.4` это 98,6 м/с, а предел истории 22. Прогон одной такой машины, `policyCareful`, 40 с: одно столкновение, `committed: yield`, поездка доезжает. `policyNever` тоже бьёт. Удержание педали с 50 м останавливает машину на `s ≈ 42` с зазором около 34 м и без удара, и дальше она не едет: объезда нет. Trust-машина при `policyCareful` и `policyNever` снимается как `avoid` без удара.

Это не правка физики в этом коммите: смена класса столкновения меняет смысл бесконечного заезда, а четыре урока эту машину не содержат. Отдельного регресса, который закреплял бы удар как желаемое поведение, не добавлялось.

## 3. Ввод, пауза, Safari и Android Chrome

Один и тот же CSS и один `fitCanvas` для обоих движков. Отдельной ветки только для Safari нет.

В Playwright при 1280×720 у Chromium 141 и WebKit 26 совпали `innerWidth/innerHeight`, `visualViewport` (offset 0, scale 1), `clientWidth/clientHeight` у `#wrap` и прямоугольник canvas: все 1280×720. `box-sizing` у `#wrap` — `border-box`, безопасные поля 0. На 844×390 без дополнительных полей canvas стал 693×390, отношение сторон около 16:9. Равенство `#wrap` и `visualViewport` измерено в этих двух headless-движках. На iOS layout viewport и visual viewport могут расходиться; этот прогон такого расхождения не создавал.

Портрет по-прежнему прячет поле и просит повернуть телефон. Вертикальной игры нет. Тест портрета зелёный в Chromium и в WebKit.

### 3.1. Потеря захвата указателя оставляла педаль нажатой. Серьёзность: Средняя. Статус: исправлено в ветке, не опубликовано.

Было, `ce1f0206e39c4a743162b10a23ec74e322c938db`, `js/game.js`, слушатели педали. Тот же фрагмент ещё в `c6e5906`. `pointerup` и `pointercancel` отпускали педаль только своего `pointerId`. События `lostpointercapture` не было. Если браузер забирает захват и не присылает `pointerup`, `brakeHeld` остаётся истинным.

```javascript
canvas.addEventListener("pointerup", (event) => releasePointer(event.pointerId));
canvas.addEventListener("pointercancel", (event) => releasePointer(event.pointerId));

function releasePointer(pointerId) {
  if (!session || session.pointerId !== pointerId) return;
  session.pointerId = null;
  session.brakeHeld = false;
}
```

Стало, те же функции:

```javascript
canvas.addEventListener("pointerup", (event) => releasePointer(event.pointerId));
canvas.addEventListener("pointercancel", (event) => releasePointer(event.pointerId));
canvas.addEventListener("lostpointercapture", (event) => releasePointer(event.pointerId));

function releasePointer(pointerId) {
  if (!session || session.pointerId !== pointerId) return;
  session.pointerId = null;
  session.brakeHeld = false;
}
```

Регрессия: Playwright «losing pointer capture releases the pedal» и «pointercancel releases the pedal and a second finger cannot hold it». Оба зелёные в Chromium и в WebKit. Второй палец (`pointerId` 2) не перехватывает педаль и его `pointerup` не отпускает педаль первого. Это синтетические `PointerEvent` в headless, не два пальца на стекле.

Инвариант, который эти тесты держат: педаль принадлежит одному `pointerId`. Чужой up/cancel её не трогает. Свой cancel и потеря захвата отпускают.

### 3.2. Кадр на 1 пиксель уже вьюпорта сохранялся и мог обрезаться. Серьёзность: Средняя для коммита `c6e5906`. В опубликованном `ce1f020` этой функции не было. Статус: исправлено в ветке, не опубликовано.

Было, `c6e590671e87b1333dca568e7779daf14847e7e1`, `js/viewport.js`, `stableFrame`. Допуск 2 пикселя оставлял прежний размер, даже если новый вьюпорт меньше. Холст оказывался выше или шире доступного прямоугольника.

```javascript
export function stableFrame(previous, viewW, viewH, slack = 2) {
  const next = frameSize(viewW, viewH);
  if (!previous) return next;
  if (Math.abs(next.width - previous.width) <= slack && Math.abs(next.height - previous.height) <= slack) {
    return previous;
  }
  return next;
}
```

На 844×390 оба движка до этой правки давали левый край 75,5. Серия высот 390, 391, 390 сдвигала верх 0 → 0,5 → 0 при той же ширине 693. Размер держался, центр flex-контейнера уезжал на полпикселя. Сжатие до 389 применялось и давало 691×389. Это замер Playwright, не iPhone.

Стало, модуль `js/viewport.js` целиком. Прежний размер остаётся, только если он всё ещё влезает и отличие не больше допуска. Центр округляется до целого пикселя и не переезжает, пока новый центр в пределах 1 пикселя и старый не вылезает наружу.

```javascript
/**
 * Fit the 1600×900 frame in whole CSS pixels inside the box that is actually
 * free for the picture. A one-pixel toolbar twitch must not resize or recenter
 * that frame. A shrink that would clip is applied. The same math is used for
 * every browser; it does not assume that 100vh itself moves.
 */
export function contentBox(clientW, clientH, padding = {}) {
  const top = Math.max(0, Number(padding.top) || 0);
  const right = Math.max(0, Number(padding.right) || 0);
  const bottom = Math.max(0, Number(padding.bottom) || 0);
  const left = Math.max(0, Number(padding.left) || 0);
  return {
    width: Math.max(1, clientW - left - right),
    height: Math.max(1, clientH - top - bottom),
  };
}

export function frameSize(viewW, viewH, logicalW = 1600, logicalH = 900) {
  const availW = Math.max(1, Math.floor(viewW));
  const availH = Math.max(1, Math.floor(viewH));
  let width = availW;
  let height = Math.floor((width * logicalH) / logicalW);
  if (height > availH || height < 1) {
    height = availH;
    width = Math.max(1, Math.floor((height * logicalW) / logicalH));
  }
  return { width, height };
}

export function frameOrigin(outerW, outerH, frame) {
  return {
    left: Math.round((outerW - frame.width) / 2),
    top: Math.round((outerH - frame.height) / 2),
  };
}

export function stableFrame(previous, viewW, viewH, slack = 2) {
  const next = frameSize(viewW, viewH);
  if (!previous) return next;
  const fits = previous.width <= next.width && previous.height <= next.height;
  const small = Math.abs(next.width - previous.width) <= slack && Math.abs(next.height - previous.height) <= slack;
  if (fits && small) return { width: previous.width, height: previous.height };
  return next;
}

export function stablePlacement(previous, outerW, outerH, slack = 2) {
  const size = stableFrame(previous, outerW, outerH, slack);
  const origin = frameOrigin(outerW, outerH, size);
  if (!previous || previous.left === undefined || previous.top === undefined) {
    return { width: size.width, height: size.height, left: origin.left, top: origin.top };
  }
  const inside =
    previous.left >= 0 &&
    previous.top >= 0 &&
    previous.left + size.width <= outerW + 0.01 &&
    previous.top + size.height <= outerH + 0.01;
  const still =
    Math.abs(origin.left - previous.left) <= 1 && Math.abs(origin.top - previous.top) <= 1;
  if (inside && still) {
    return { width: size.width, height: size.height, left: previous.left, top: previous.top };
  }
  return { width: size.width, height: size.height, left: origin.left, top: origin.top };
}
```

Регрессия: юнит «the mobile frame stays on whole pixels when the toolbar jitters». Рост 390→391 сохраняет размер и целый центр. Сжатие 390→389 обязано влезть в 389 по высоте и в 844 по ширине. Возврат к 390 не раздувает кадр обратно внутри допуска. Отношение сторон после `Math.floor` на этих размерах отличается от 16:9 меньше чем на 0,02. Playwright на 844×390, 915×412 и 800×360 после серии ±1 и ±2 пикселя держит верх, левый край и высоту в пределах 1,5 пикселя. Отдельно на 390, 391, 390 после правки Chromium и WebKit дали один и тот же прямоугольник: left 76, top 0, 693×390 на всех трёх шагах.

Округление: 390×1600/900 = 693,333, в кадре ширина 693. Центр (844−693)/2 = 75,5, `Math.round` даёт 76. Правый остаток на пиксель меньше левого. Это целая постановка, не дрожание.

### 3.3. Безопасные поля сжимали кадр по одной оси. Серьёзность: Средняя для коммита `c6e5906`. В `ce1f020` полей `safe-area` не было, там этого сжатия не было. Статус: исправлено в ветке, не опубликовано.

`#wrap` имеет `box-sizing: border-box` и `padding: env(safe-area-inset-*)`. `clientWidth` включает padding. Прежний `fitCanvas` принимал этот размер за свободное место и ставил холсту высоту всего клиентского прямоугольника. CSS `max-height: 100%` затем ужимал уже использованную высоту до контентной, ширину оставлял. Пропорция ломалась.

Замер до правки, оба движка, вьюпорт 844×390, на `#wrap` выставлен padding `0 47px 21px 47px` (в Playwright `env(safe-area-inset-*)` равен 0, поэтому поле задано стилем):

- контентный прямоугольник 750×369
- стиль холста `693px` на `390px`
- нарисованный прямоугольник 693×369
- отношение сторон 1,878
- из контента наружу не торчал, потому что `max-height` уже сжал высоту

Это синтетика заданного padding, не вырез настоящего iPhone.

Было, `c6e5906`, `js/game.js`, `fitCanvas`:

```javascript
function fitCanvas() {
  const wrap = document.getElementById("wrap");
  const box = window.visualViewport;
  const width = wrap && wrap.clientWidth > 0 ? wrap.clientWidth : box?.width || window.innerWidth;
  const height = wrap && wrap.clientHeight > 0 ? wrap.clientHeight : box?.height || window.innerHeight;
  const next = stableFrame(frameSize, width, height);
  if (frameSize && next.width === frameSize.width && next.height === frameSize.height) return;
  frameSize = next;
  canvas.style.width = `${next.width}px`;
  canvas.style.height = `${next.height}px`;
}
```

Стало:

```javascript
function fitCanvas() {
  const wrap = document.getElementById("wrap");
  const box = window.visualViewport;
  let outerW = box?.width || window.innerWidth;
  let outerH = box?.height || window.innerHeight;
  let originX = 0;
  let originY = 0;
  if (wrap && wrap.clientWidth > 0 && wrap.clientHeight > 0) {
    const style = getComputedStyle(wrap);
    const pad = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
    const inner = contentBox(wrap.clientWidth, wrap.clientHeight, pad);
    outerW = inner.width;
    outerH = inner.height;
    const rect = wrap.getBoundingClientRect();
    originX = rect.left + pad.left;
    originY = rect.top + pad.top;
  }
  const next = stablePlacement(placement, outerW, outerH);
  if (
    placement &&
    next.width === placement.width &&
    next.height === placement.height &&
    next.left === placement.left &&
    next.top === placement.top
  ) {
    return;
  }
  placement = next;
  canvas.style.position = "fixed";
  canvas.style.left = `${Math.round(originX + next.left)}px`;
  canvas.style.top = `${Math.round(originY + next.top)}px`;
  canvas.style.width = `${next.width}px`;
  canvas.style.height = `${next.height}px`;
}
```

После правки те же 844×390 и тот же padding, оба движка: холст 656×369, отношение 1,777…, левый край 94, верх 0, прямоугольник внутри контента 750×369. Регрессия: Playwright «safe-area padding keeps a 16:9 canvas inside the content box», Chromium и WebKit.

CSS по-прежнему сначала пишет `vh`, затем `svh`, как запас до скрипта. Скрипт ставит целые пиксели и перекрывает оба. Поведение самого `100vh` на телефонах этим не измерялось.

### 3.4. Ключ `interactive-widget` давал ошибку консоли в Playwright WebKit 26. Серьёзность: Низкая. Это регрессия промежуточного патча `c6e5906`, не опубликованной базы. Статус: исправлено в ветке, не опубликовано.

В `ce1f020` мета viewport была `width=device-width, initial-scale=1, viewport-fit=cover`. Коммит `c6e5906` добавил `interactive-widget=overlays-content`. Текстовых полей в игре нет, клавиатура в заезде не открывается. Playwright WebKit 26.0 пишет в консоль ошибку `Viewport argument key "interactive-widget" not recognized and ignored.` и ключ отбрасывает. Полный набор из 17 тестов на этом WebKit сначала дал 13 зелёных и 4 красных. Красными были только проверки пустой консоли. Игровые утверждения в этих четырёх (старт, пауза, повтор урока 1, торт, панический груз) до строки про консоль уже проходили.

Было, `c6e590671e87b1333dca568e7779daf14847e7e1`, `index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content">
```

Стало, та же строка:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Регрессия: полный Playwright на WebKit после снятия ключа. Chromium этот ключ не ругал; снятие не меняет расчёт кадра.

### Размер пальца. Наблюдение, не правка.

На 844×390 без лишнего padding кнопка «В урок» была 194×48,5 CSS-пикселя, «Гараж» на титуле 194×32,9. С полем 21 пиксель снизу после правки: «В урок» 183,7×45,9, «Гараж» 183,7×31,2. Вторая ниже привычных 44 CSS-пикселей. Промахов пальцем в этой среде нет: клик идёт в центр горячей зоны, и тест «start control inside the canvas» зелёный. Кнопки не увеличивались: это был бы перерисованный интерфейс, а не подтверждённый промах.

## 4. Производительность

Снято здесь, headless, 1280×720, 90 кадров после короткой паузы. Время кадра — это длительность колбэка `requestAnimationFrame` игры (шаги симуляции и `render`), не время видеокарты и не частота экрана телефона. Интервал — пауза между входами в этот колбэк на этой машине.

| Движок | Сцена | Интервал, среднее / p50 / p95 / макс, мс | JS кадра, среднее / p95 / макс, мс | Кадров с JS дольше 16 мс |
| --- | --- | --- | --- | --- |
| Chromium 141 | титул | 16,68 / 16,7 / 16,8 / 18,1 | 0,35 / 0,5 / 0,5 | 0 из 90 |
| Chromium 141 | урок, фаза drive | 16,79 / 16,7 / 17 / 28,1 | 0,40 / 0,6 / 1,2 | 0 из 90 |
| WebKit 26 | титул | 19,79 / 19 / 23 / 31 | 2,54 / 3 / 4 | 0 из 90 |
| WebKit 26 | урок, фаза drive | 21,62 / 21 / 25 / 37 | 2,52 / 3 / 4 | 0 из 90 |

У WebKit интервал до 37 мс встретился при JS кадра не длиннее 4 мс. Этот хвост принадлежит планировщику headless, не прорисовке. Отсюда не следует частота кадров на iPhone или Android.

Отдельно Node, 20 прогонов урока 1 политикой `policyCareful` до 90 с симуляции: 80,8 мс на все, 4,04 мс на один прогон. Это интегратор без холста.

По исходнику слушатели вешаются один раз: pointerdown, pointerup, pointercancel, lostpointercapture, keydown, keyup, blur, visibilitychange, resize окна и resize `visualViewport`, если он есть. В `frame` новых слушателей нет. Цикл один. Радио держит один `setTimeout` и снимает его в `stopRadio`. Осцилляторы отключаются в `onended`. Следы ограничены 12 точками. `render` каждый кадр заново собирает массив пятен, подписей и декораций (шаг 14 м, два борта, плюс опасности в обзоре, у урока их в кадре единицы) и выбрасывает. Рост этих массивов от кадра к кадру в коде не заложен. Снимка кучи после долгой сессии нет, поэтому утечка на часовом заезде не измерялась.

Отдельный backing store под devicePixelRatio не делался. Резкость на ретине остаётся непроверенным риском, серьёзность Низкая. Он не является измеренным сдвигом всего кадра.

## 5. Картинка и анимация

Титул — застывшая сцена: `preview.s = 30`, симуляция титула не шагается, `drawWorld(..., motion=false)` не рисует скоростные штрихи. Поверх этого каждые 110 мс `Math.floor(now / 110) % 2` переключает `boil`. Кнопки в этот флаг не входят.

Съёмка обычного темпа, 1280×720, порог суммы каналов больше 24. Прямоугольники логического холста 1600×900. «До» — `js/draw.js` из `c6e5906`. «После» — текущее дерево. Худший кадр за серию сэмплов около 440 мс, пока фаза boil не сменилась.

| Область | До, Chromium | После, Chromium | После, WebKit 26 |
| --- | --- | --- | --- |
| Кнопки 1092,640 448×204 | 0 | 0 | 0 |
| Крона слева 140,280 240×320 | 1228 пикс., макс. 559 | 0 | 0 |
| Колёса 640,670 140×140 | 538 пикс., макс. 616 | 0 | 0 |
| Пешеход 560,360 180×220 | 960 пикс., макс. 309 | 898 пикс., макс. 224 | 893 пикс., макс. 224 |
| Волосы Антона 1180,90 280×180 | 146 пикс., макс. 545 | 146 пикс., макс. 545 | 119 пикс., макс. 545 |
| Дорожная панель 40,80 980×760 | 5522 пикс., макс. 616 | в этом срезе не переснималась целиком | в срезе до отдельного кропа дороги было 893 |

Кадры: `artifacts/qa-title-before.png`, `artifacts/qa-title-after.png`, `artifacts/qa-title-webkit.png`. Разница двух фаз до правки: `artifacts/qa-title-motion-before.png`. После: `artifacts/qa-title-motion-after.png`. Кадр с полем: `artifacts/qa-safe-area-chromium.png`.

Кнопки внутри растра не двигались ни до, ни после. Движение всей картинки вместе с «В урок» этими кадрами не воспроизведено. Воспроизведено другое: на неподвижном титуле декорации, колёса, пешеход и волосы щелкали сами по себе.

### 5.1. Дома и деревья прыгали каждые 110 мс. Серьёзность: Средняя. Статус: исправлено в ветке, не опубликовано.

Это не гипотеза про запись целиком. Это отдельный, измеренный внутренний сдвиг.

Было, `ce1f020` и всё ещё `c6e5906`, `js/draw.js`. `drawProp` передавал `boil` в дома и деревья. Крона: `ctx.arc(boil ? 4 : -3, -36, 34, ...)`, это 7 локальных пикселей вправо-влево. Дом вида 0 сдвигался на `bob` 1,2. На титуле дорога не едет, поэтому щелчок виден относительно кнопки. Кроп кроны до правки: 1228 изменившихся пикселей.

Стало, `drawProp` целиком. Люди, собака и Антон по-прежнему получают `boil`. Дома и деревья получают 0.

```javascript
function drawProp(ctx, item, boil) {
  const spot = project(item.ds, item.xm);
  if (spot.y < -30 || spot.y > 940) return;
  const sc = Math.max(0.42, Math.min(1.2, spot.scale));
  const color = [P.PINK, P.BLUE, P.ORANGE, P.YEL, P.TEAL][Math.abs(item.n + item.side) % 5];
  const cycle = Math.abs(item.n * 2 + (item.side > 0 ? 1 : 4)) % 7;
  shadowAt(ctx, spot.x, spot.y, sc, 46);
  // Houses and trees stay put. The 110 ms boil is only for people, dogs and Anton.
  if (item.band === "market") {
    drawBuilding(ctx, spot.x, spot.y, sc, cycle % 2 === 0 ? 1 : 4, color, 0, true);
    return;
  }
  if (item.band === "edge") {
    if (cycle % 3 === 0) drawTree(ctx, spot.x, spot.y, sc, 0, item.n);
    else drawBuilding(ctx, spot.x, spot.y, sc * 1.1, 3, color, 0, false);
    return;
  }
  if (cycle === 0 || cycle === 5) drawTree(ctx, spot.x, spot.y, sc, 0, item.n);
  else if (cycle === 1) drawBuilding(ctx, spot.x, spot.y, sc, 0, color, 0, Math.abs(item.n) % 3 === 0);
  else if (cycle === 2) drawBuilding(ctx, spot.x, spot.y, sc, 1, color, 0, false);
  else if (cycle === 3) drawBuilding(ctx, spot.x, spot.y, sc, 4, color, 0, false);
  else if (cycle === 4) drawBuilding(ctx, spot.x, spot.y, sc, 0, color, 0, true);
  else drawBuilding(ctx, spot.x, spot.y, sc, 2, color, 0, false);
}
```

Рисунок крон и домов не менялся. У них выключен двухкадровый сдвиг. Регрессия: Playwright «title scenery and wheels stay still while people may idle». Кроп кроны за 450 мс после первого стабильного кадра кнопок даёт 0 пикселей выше порога. Зелёный в Chromium и в WebKit.

Декорации не пересобираются случайно каждый кадр. Позиция берётся из `project(ds, xm)` (`js/road.js`), индекс из `Math.round(s / 14)`, район из `districtAt`. На титуле `s` фиксирован, поэтому набор домов стабилен. `Math.random` в прорисовке дороги нет.

### 5.2. Колёса на стоящем титуле щелкали на 0,5 радиана. Серьёзность: Средняя. Статус: исправлено в ветке, не опубликовано.

Было, `ce1f020` и `c6e5906`, `js/draw.js`, `drawCarSprite`:

```javascript
const spin = live.s * 2.6 + (boil ? 0.5 : 0);
```

На титуле `s` не меняется, поэтому вся перемена угла — это 0,5 радиана каждые 110 мс. Кроп колёс до правки: 538 пикселей, максимум 616. В движении угол и так идёт от пройденного пути; добавка boil была щелчком поверх.

Стало, `drawCarSprite` целиком. Параметр `boil` у функции остаётся, на угол больше не влияет.

```javascript
function drawCarSprite(ctx, x, y, sc, brake, sim, boil = 0) {
  ctx.save();
  ctx.translate(x, y);
  const live = sim || { s: 0, cargoType: null, cargo: 100, body: 100, t: 0, cargoFlash: 0, nearT: 0, crashT: 0, lastSelfBrake: 0 };
  const dive = (brake || 0) * CAR_DIVE;
  ctx.rotate(dive);
  ctx.scale(sc, sc * (1 - Math.min(0.16, live.crashT || 0)));
  ctx.fillStyle = "rgba(28,22,30,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 42, 40, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, -CAR_BODY_W / 2, CAR_NOSE_LOCAL_Y, CAR_BODY_W, CAR_BODY_H, 16);
  ctx.fillStyle = live.body < 45 ? "#CDB56A" : P.YEL;
  ctx.fill();
  ink(ctx, 5);
  ctx.stroke();
  ctx.fillStyle = P.GLASS;
  roundRect(ctx, -28, -50, 56, 30, 6);
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  roundRect(ctx, -18, -16, 36, 26, 4);
  ctx.fillStyle = P.RED;
  ctx.fill();
  ink(ctx, 3);
  ctx.stroke();
  paintCenter(ctx, "У", -16, -18, 32, 26, 16, P.PAPER, true, false);
  const lamps = (brake || 0) > 0.15 || live.lastSelfBrake > 0.1;
  ctx.fillStyle = lamps ? P.RED : P.ORANGE;
  ctx.fillRect(-28, 32, 16, 10);
  ctx.fillRect(12, 32, 16, 10);
  // Distance turns the wheels. The 110 ms boil used to add half a radian
  // even while the title car was standing still.
  const spin = live.s * 2.6;
  drawWheel(ctx, -28, -30, spin);
  drawWheel(ctx, 28, -30, spin);
  drawWheel(ctx, -28, 26, spin);
  drawWheel(ctx, 28, 26, spin);
  if (live.cargoType) {
    const launch = live.cargoFlash || 0;
    const tilt = Math.sin(live.t * 8) * (brake || 0) * 0.4;
    ctx.save();
    ctx.translate(0, -78 - launch * 36);
    ctx.rotate(tilt + launch * 0.6);
    drawCargoIcon(ctx, 0, 0, live.cargoType, 1, live);
    ctx.restore();
  }
  if ((brake || 0) > 0.55 && live.v > 8 && live.cargoType) {
    roundRect(ctx, -36, -118, 72, 26, 8);
    ctx.fillStyle = P.YEL;
    ctx.fill();
    ink(ctx, 3);
    ctx.stroke();
    paintCenter(ctx, live.cargoType === "fish" ? "РЫБКА" : "КРЕМ", -36, -118, 72, 26, 14, P.INK, false, false);
  }
  ctx.restore();
}
```

Регрессия та же, что в 5.1: кроп колёс за 450 мс даёт 0. После правки отдельный замер Chromium и WebKit тоже дал 0.

### 5.3. Что на титуле ещё шевелится. Статус: оставлено, это не дефект декораций.

Пешеход: ноги `boil ? 8 : -8` локальных пикселей. После правки кроп пешехода всё ещё меняется (Chromium 898, WebKit 893). Волосы Антона на чётных прядях поднимаются на 6 локальных пикселей: Chromium 146, WebKit 119. Кнопки при этом 0. Это жизнь персонажей внутри растра, не сдвиг всего холста.

Смена выражения Антона по-прежнему мгновенная: `poseShift` подставляет другую позу без промежуточного кадра. Отдельного однокадрового слома позы в этом проходе не поймано.

Уменьшенное движение уже было и сохранено. Пустое сохранение при `prefers-reduced-motion: reduce` ставит `shake: false` и `reducedMotion: true`. Тумблер «Тряска» пишет оба флага вместе. При `reducedMotion` boil становится 0, скоростные штрихи не рисуются, ударная тряска не включается. CSS-телефон на экране «поверни» не крутится. Отдельного прогона с включённым системным флагом в браузере в этом проходе не было: проверена развилка в `drawTitle`, `drawPlay` и `loadSave`.

Базовая картинка теперь такая: дома, деревья и угол колёс стоят, пока не меняется пройденный путь. Люди и Антон могут переключать два кадра покоя. Тумблер тряски и системный флаг гасят и этот покой.

Ударная тряска по-прежнему только в `drawPlay`, пока `sim.shake > 0`, и только если тряска включена. На титуле её нет.

## Звук

`createAudio` в `js/audio.js`. Контекст создаётся на жест. Если `AudioContext` нет, `ac()` возвращает `null`, вызовы тона выходят сразу. `resume()` при `suspended` ловит отказ. Выключение звука останавливает радио, глушит шум тормоза и мастер. Повторный `startRadio` при уже играющем радио не заводит второй таймер. Это чтение исходника. Отдельного прогона «выключить звук и убедиться тишиной» и прогона без API в этом проходе не было. Падения из звука юнит- и Playwright-прогоны не поймали: игровые сценарии идут со звуком по умолчанию в headless, где контекст есть.

## База и промежуточный патч

Опубликованный `ce1f020` уже содержал: щелчок домов и деревьев на 110 мс, полрадиана на колёсах стоящего титула, педаль без `lostpointercapture`.

Промежуточный `c6e5906` это не снимал и добавил своё: `stableFrame` мог оставить кадр больше вьюпорта, безопасные поля сжимали одну ось, центр уезжал на 0,5 пикселя, мета `interactive-widget` давала ошибку консоли в Playwright WebKit 26. Эти четыре пункта не были в опубликованной игре.

Припаркованная машина без trust подтверждена в бесконечном режиме и в этом коммите не менялась.

## Что прогнано

Матрица ниже относится к дереву после снятия `interactive-widget` и после правки скрипта педали. До снятия ключа полный WebKit был 13/17: все 4 падения были одной консольной строкой, игровые проверки урока в том прогоне до неё доходили. После снятия ключа один прогон урока 1 на WebKit закончился с одним столкновением. Скрипт жал педаль после скриншота, а на масштабе 4 медленный снимок успевал довезти машину до человека. Теперь педаль ставится по уже прочитанному состоянию, а на время снимка `setTimeScale(0)`. Это правка теста, не физики. Повтор того же теста на WebKit дважды после правки зелёный.

- `npm test`: 31/31
- `npm run lint`: без ошибок
- `npm run check`: syntax ok, 19 файлов
- Playwright Chromium 141: 17/17
- Playwright WebKit 26.0: 17/17, тот же `test/e2e.spec.js`, включая урок 1, торт, повтор, ранний зазор и панический груз
- Пиксельный срез титула и 90 кадров стоимости JS, числа выше
- Физические iPhone и Android: не проверялись

| Проверка | Chromium | WebKit 26 |
| --- | --- | --- |
| Обычный темп: старт, тормоз, пауза | да | да |
| Letterbox и портрет | да | да |
| Дрожание высоты, 16:9, безопасные поля | да | да |
| Кроп титула: кроны и колёса стоят | да | да |
| Потеря захвата, cancel, второй палец | да | да |
| Урок 1 с промахом, повтором и остановкой | да | да |
| Торт | да | да |
| Повтор кликом, R и залипший пробел | да | да |
| Касание повтора на 844×390 | да | да |
| Ранний зазор на 1280 и 844×390 | да | да |
| 6× осторожный урок и панический торт | да | да |

## Непроверенные риски

Серьёзность не назначается как подтверждённому дефекту.

- На том iPhone Safari вся картинка может по-прежнему ехать относительно панели браузера. Headless этого не повторил.
- Поведение `100vh` и расхождение layout viewport с visual viewport на версии iOS владельца не измерялись.
- Настоящий вырез, жест «домой», DPR и два пальца на стекле Android Chrome не проверялись. Padding в тесте задан числом.
- Долгая сессия и нагрев не снимались.
- Кнопка «Гараж» высотой около 33 CSS-пикселей на 844×390 может быть тесной. Промаха в тесте нет.
- Звук при реальной приостановке контекста на телефоне не слушался.

## Что проверить владельцу, если телефон всё ещё нужен

Один и тот же приём на iPhone Safari, с которого была запись, и на одном Android Chrome. Открыть титул, не трогать экран, дождаться, пока адресная строка перестанет ехать. Две отдельные заметки: едет ли вся картинка вместе с «В урок» относительно рамки браузера; прыгают ли деревья относительно этой кнопки. Вторая заметка в этой среде уже закрыта кропом (деревья стоят). Первая этой средой не закрыта.

## Что не публиковать вместе с этим

PR5, коммит `296a164f385571046316ca0539e848012bcc816c`: телефон в уроке 1 и сон в уроке 2. Ветка QA от `main` `ce1f020` этих коммитов не содержит. Слияние и выкладка этой QA-ветки не делались.

Этот проход не утверждает, что найдены все дефекты.
