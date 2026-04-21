# Attachment Optimizer for Thunderbird

Rozszerzenie do Thunderbirda, które automatycznie kompresuje obrazy i PDF-y przed wysłaniem.

## Co robi

- **Obrazy** → konwersja do WebP (jakość 82%, max 1920px). PNG z przezroczystością zostaje jako PNG.
- **Skany PDF** → renderowanie stron jako JPEG i przepakowanie — oszczędność 70–90%.
- **PDF wektorowy / techniczny** → wykrywany automatycznie i pomijany (zachowana jakość).
- Pliki już małe lub słabo kompresujące się → pomijane bez zmian.

## Instalacja

1. Pobierz najnowszy plik `.xpi` z [Releases](../../releases/latest)
2. W Thunderbirdzie: `Ctrl+Shift+A` → ikona ⚙️ → **Zainstaluj dodatek z pliku...**
3. Wskaż pobrany `.xpi` → **Dodaj**

## Jak używać

### Przeciąganie plików

Przeciągnij plik na okno pisania wiadomości — pojawi się nakładka z dwoma strefami:

| Strefa | Efekt |
|--------|-------|
| 📎 Lewa — *Jako załącznik* | Kompresuje i dołącza jako załącznik |
| 📄 Prawa — *Wstaw do treści* | Kompresuje i wstawia inline w treść maila |

### Przekazywanie wiadomości

Przy otwarciu okna pisania z istniejącymi załącznikami pojawia się banner:

> 📎 3 załączniki (12.4 MB) — zoptymalizować?  **[Zoptymalizuj]**

### Włącz / Wyłącz

Kliknij ikonę rozszerzenia w głównym pasku Thunderbirda (ikona strzałek). Szara z przekreśleniem = wyłączone.

## Wymagania

- Thunderbird 128–151
