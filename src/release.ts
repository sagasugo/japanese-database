import { readdir } from "node:fs/promises";
import type { Kanji, Word, Reading, KanjiTranslation, WordTranslation, } from "./types";
import { db } from "./db/client";
import { kanjis, kanjiTranslation, radicalKeyword, radicals, readings, words, wordTranslations } from "./db/schema";

let lodash = require("lodash");

(async () => {
  const [kanjiBase, wordBase, radicalBase, readingsData]: [
    Record<string, Kanji>,
    Record<string, Word>,
    string[],
    Record<string, Reading>
  ] = await Promise.all([
    Bun.file("./database/base/kanji.json").json(),
    Bun.file("./database/base/word.json").json(),
    Bun.file("./database/base/radical.json").json(),
    Bun.file("./database/base/reading.json").json(),
  ])
  const translationFiles = await readdir("./database/translation", { recursive: true })
  const availableLangs = translationFiles.filter(f => !f.includes("/"))

  const translationKanji: Record<string, Record<string, KanjiTranslation>> = {}
  const translationWord: Record<string, Record<string, WordTranslation>> = {}
  const keywordRadical: Record<string, Record<string, string>> = {}

  console.log(availableLangs)
  for (let lang of availableLangs) {
    if (translationFiles.includes(`${lang}\\kanji.json`))
      translationKanji[lang] = await Bun.file(`./database/translation/${lang}/kanji.json`).json()
    if (translationFiles.includes(`${lang}\\word.json`))
      translationWord[lang] = await Bun.file(`./database/translation/${lang}/word.json`).json()
    if (translationFiles.includes(`${lang}\\radical.json`))
      keywordRadical[lang] = await Bun.file(`./database/translation/${lang}/radical.json`).json()
  }

  const releaseJson: {
    kanji: Record<string, Kanji & { meaning: Record<string, KanjiTranslation> }>,
    word: Record<string, Word & { meaning: Record<string, WordTranslation> }>,
    radical: Record<string, { radical: string, keyword: Record<string, string> }>,
    reading: Record<string, Reading>
  } = {
    kanji: {},
    word: {},
    radical: {},
    reading: readingsData
  }

  Object.entries(kanjiBase)
    .forEach(value => {
      const [k, kanji] = value as [string, Kanji];
      releaseJson.kanji[k] = {
        ...kanji,
        meaning:
          Object.fromEntries(
            availableLangs
              .filter(lang => translationKanji[lang]?.[k])
              .map(lang => [lang, translationKanji[lang][k]])
          )
      }
    })
  Object.entries(wordBase)
    .forEach(value => {
      const [w, word] = value as [string, Word]
      releaseJson.word[w] = {
        ...word,
        meaning:
          Object.fromEntries(
            availableLangs
              .filter(lang => translationWord[lang]?.[w])
              .map(lang => [lang, translationWord[lang][w]]))
      }
    })
  radicalBase
    .forEach((c: string) => {
      releaseJson.radical[c] = {
        radical: c,
        keyword:
          Object.fromEntries(
            availableLangs
              .filter(lang => keywordRadical[lang]?.[c])
              .map(lang => [lang, keywordRadical[lang][c]])
          )
      }
    })

  Bun.file("./out/database.json").write(JSON.stringify(releaseJson))

  const kanjiInsert = Object.values(kanjiBase).map(k => {
    return {
      kanji: k.kanji,
      unicode: k.unicode,
      strokeCount: k.stroke_count,
      jlpt: k.jlpt,
      grade: k.grade,
      mainichiShinbun: k.mainichi_shinbun,
      mainOnReading: k.main_on_reading,
      mainKunReading: k.main_kun_reading,
      onReadings: k.on_readings,
      kunReadings: k.kun_readings,
      nameReadings: k.name_readings,
      radicals: k.radicals,
      relatedWords: k.related_words
    }
  })

  const wordInsert = Object.values(wordBase).map(w => {
    return {
      mainWriting: w.main_writing,
      mainReading: w.main_reading,
      mainKanjis: w.main_kanjis,
      variants: w.variants
    }
  })

  const kanjiTranslationInsert = Object.entries(translationKanji).flatMap(([lang, kanji]) =>
    Object.entries(kanji).map(([k, kt]) => {
      return {
        kanji: k,
        language: lang,
        keyword: kt.keyword,
        meanings: kt.meanings,
        notes: kt.notes,
        autoTranslated: kt.auto_translated
      }
    }))

  const wordTranslationInsert = Object.entries(translationWord).flatMap(([lang, word]) =>
    Object.entries(word).map(([writing, m]) => {
      return {
        writing,
        language: lang,
        mainMeaning: m.main_meaning,
        meanings: m.meanings,
        autoTranslated: m.auto_translated
      }
    })
  )

  const radicalKeywordInsert = Object.entries(keywordRadical).flatMap(([lang, radical]) =>
    Object.entries(radical).map(([r, keyword]) => {
      return {
        radical: r,
        language: lang,
        keyword
      }
    })
  )



  for (const chunk of lodash.chunk(Object.values(kanjiInsert), 100)) {
    await db.insert(kanjis).values(chunk)
  }

  for (const chunk of lodash.chunk(Object.values(wordInsert), 100)) {
    await db.insert(words).values(chunk)
  }

  await db.insert(radicals).values(
    radicalBase.map(r => {
      return {
        radical: r
      }
    })
  )

  for (const chunk of lodash.chunk(Object.values(kanjiTranslationInsert), 100)) {
    await db.insert(kanjiTranslation).values(chunk)
  }

  for (const chunk of lodash.chunk(Object.values(wordTranslationInsert), 100)) {
    await db.insert(wordTranslations).values(chunk)
  }

  for (const chunk of lodash.chunk(Object.values(radicalKeywordInsert), 100)) {
    await db.insert(radicalKeyword).values(chunk)
  }

  for (const chunk of lodash.chunk(Object.values(readingsData), 100)) {
    await db.insert(readings).values(chunk)
  }

})()
