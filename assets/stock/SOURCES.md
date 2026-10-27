# Общие фото «для примера» (assets/stock/)

Показываются на карточке позиции, у которой нет своего фото, с подписью «Фото для примера».
Несколько кадров на вид: `<kind>.jpg`, `<kind>-2.jpg`, `<kind>-3.jpg` — build.js раздаёт их позициям одного вида по очереди.
`hero.jpg` — отдельный широкий кадр для первого экрана, если у компании нет своего фото.
Фото с Unsplash (Unsplash License — https://unsplash.com/license) и Pexels (Pexels License — https://www.pexels.com/license/):
бесплатно, в том числе для коммерческого использования, атрибуция не обязательна; авторов указываем из уважения.

Обработка: кадрирование 16:10 и сжатие средствами сервиса (Unsplash: `w=1200&h=750&fit=crop&q=…&fm=jpg`,
Pexels: `w=1200&h=750&fit=crop&auto=compress`), 1200×750, ≤ 200 КБ.

| Файл | Что на фото | Страница фото | Автор |
|---|---|---|---|
| excavator.jpg | Гусеничный экскаватор на щебне | https://unsplash.com/photos/yellow-and-black-excavator-on-rocky-ground-WoZs8gGyQBY | Gerold Hinzen — https://unsplash.com/@geroldhinzen |
| crane.jpg | Автокран на шасси грузовика (ч/б) | https://unsplash.com/photos/mobile-crane-truck-on-dirt-lot-G_Z6qfBm2Hk | Anton Kotov — https://unsplash.com/@kotovunspash |
| dump_truck.jpg | Карьерный самосвал с грузом | https://unsplash.com/photos/a-dump-truck-driving-down-a-dirt-road-7qFRRHjfJ6c | Lars Portjanow — https://unsplash.com/@larsportjanow |
| loader.jpg | Фронтальный погрузчик | https://unsplash.com/photos/shallow-focus-photo-of-yellow-front-loader-8PKEeac1hzw | Samuel Horn af Rantzien — https://unsplash.com/@pixelcrook |
| manipulator.jpg | Бортовой грузовик с краном-манипулятором | https://unsplash.com/photos/a-white-crane-truck-parked-outdoors-near-trees-183kVHdJT_I | Bernd Dittrich — https://unsplash.com/@hdbernd |
| aerial_platform.jpg | Коленчатый подъёмник у здания (Pexels) | https://www.pexels.com/photo/orange-and-black-heavy-equipment-on-road-9690057/ | Jonathan Cooper — https://www.pexels.com/@theshuttervision/ |
| bulldozer.jpg | Гусеничный бульдозер в карьере | https://unsplash.com/photos/a-powerful-yellow-bulldozer-on-a-white-quarry--mx0XkVtbYE | Valentin — https://unsplash.com/@omikron |
| roller.jpg | Два дорожных катка на новом асфальте | https://unsplash.com/photos/two-yellow-road-rollers-on-asphalt-UVokx-KrIu4 | Nadin Nandin — https://unsplash.com/@nadin_nandin |
| tractor.jpg | Трактор в поле | https://unsplash.com/photos/green-tractor-on-brown-grass-field-under-blue-sky-during-daytime-dDc0vuVH_LU | Randy Fath — https://unsplash.com/@randyfath |
| excavator-2.jpg | Гусеничный экскаватор в котловане | https://unsplash.com/photos/yellow-and-black-excavator-on-brown-soil-maVHoAWycOs | Abdul Zreika — https://unsplash.com/@sandaproductions |
| mini_loader.jpg | Мини-погрузчик (skid steer) с грунтом | https://unsplash.com/photos/skid-steer-loader-moving-dirt-in-a-wooded-area-AB_TBnAjjTg | Chandler Cruttenden — https://unsplash.com/@chanphoto |
| hero.jpg | Стройплощадка: экскаватор грузит самосвал (первый экран) | https://unsplash.com/photos/excavator-dumping-soil-into-dump-truck-eKY6_9W_iqY | Troy Mortier — https://unsplash.com/@troyscanon |

Логотип производителя виден на bulldozer.jpg (CAT) — допустимо. На manipulator.jpg мелкий значок производителя на решётке и номер,
на aerial_platform.jpg — мелкая наклейка на стреле, в карточке не читается. Рекламы прокатчиков нет.
crane.jpg — чёрно-белый: цветного автокрана без рекламы прокатчика и без обрезки стрелы на Unsplash/Pexels не нашлось.
`other` — без фото, показывается SVG-иконка.
