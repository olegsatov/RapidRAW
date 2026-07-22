LUT Extractor — извлечение .cube LUT из Dehancer
===================================================

Как вытащить пленочный LUT из Dehancer:

1. Открой hald_identity_512.png (или 1024) в Dehancer standalone
2. Выбери нужный Film Negative + Film Print профили
3. Отключи ВСЕ остальные эффекты (grain, halation, bloom и т.д.)
4. Экспортируй как TIFF
5. Запусти:

   python3 hald_extract.py обработанный.tiff -n "Название пленки" -o output.cube

   Для 1024 HALD нужно указать размер куба явно:
   python3 hald_extract.py обработанный.tiff -n "Название" -o output.cube -s 101

Файлы:
  hald_identity.py     — генератор identity HALD (если нужен другой размер)
  hald_extract.py      — экстрактор .cube из обработанного HALD (поддерживает TIFF/PNG/PPM)
  hald_identity_512.png  — 512×512, куб 64³ (стандарт, 7 MB LUT)
  hald_identity_1024.png — 1024×1024, куб 101³ (точнее, 27 MB LUT)

Готовый LUT:
  Kodak Portra 400.cube — 64³, извлечён из Dehancer v7
