// Optional experiments. Run after importing the assignment data into the chosen DB.
// Repeated runs use a forced collection scan as the baseline and reuse named indexes.
(() => {
  const tracks = db.getCollection("tracks");
  const partyIndex = "nosql_1_genre_popularity_danceability";
  const focusIndex = "nosql_1_explicit_instrumentalness_speechiness";
  const popFilter = { track_genre: "pop", "audio_features.danceability": { $gte: 0.7 } };
  const focusFilter = {
    explicit: false,
    "audio_features.instrumentalness": { $gt: 0.5 },
    "audio_features.speechiness": { $lt: 0.1 },
    "audio_features.loudness": { $lt: -10 }
  };
  const coverageFilter = { track_genre: "pop", popularity: { $gte: 70 } };

  function summarize(explain) {
    const stages = new Set();
    const indexNames = new Set();
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (typeof node.stage === "string") stages.add(node.stage);
      if (typeof node.indexName === "string") indexNames.add(node.indexName);
      for (const value of Object.values(node)) walk(value);
    }
    walk(explain.queryPlanner.winningPlan);
    const s = explain.executionStats;
    return {
      stages: [...stages],
      indexes: [...indexNames],
      nReturned: s.nReturned,
      totalKeysExamined: s.totalKeysExamined,
      totalDocsExamined: s.totalDocsExamined,
      executionTimeMillis: s.executionTimeMillis
    };
  }

  const popBaseline = summarize(tracks.find(popFilter).sort({ popularity: -1 })
    .hint({ $natural: 1 }).explain("executionStats"));
  const focusBaseline = summarize(tracks.find(focusFilter)
    .hint({ $natural: 1 }).explain("executionStats"));

  // Equality, then sort, then the range aligned with the ordered query.
  tracks.createIndex(
    { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
    { name: partyIndex }
  );
  tracks.createIndex(
    { explicit: 1, "audio_features.instrumentalness": 1, "audio_features.speechiness": 1 },
    { name: focusIndex }
  );

  const popIndexed = summarize(tracks.find(popFilter).sort({ popularity: -1 })
    .hint(partyIndex).explain("executionStats"));
  const focusIndexed = summarize(tracks.find(focusFilter)
    .hint(focusIndex).explain("executionStats"));
  const noProjection = summarize(tracks.find(coverageFilter)
    .hint(partyIndex).explain("executionStats"));
  const coveredProjection = summarize(tracks.find(coverageFilter, {
    _id: 0, track_genre: 1, popularity: 1
  }).hint(partyIndex).explain("executionStats"));

  const output = {
    genreDanceability: { collectionScan: popBaseline, indexed: popIndexed },
    focus: { collectionScan: focusBaseline, indexed: focusIndexed },
    coverage: { fullDocuments: noProjection, indexOnlyProjection: coveredProjection }
  };
  if (process.env.NOSQL_QUERY_OUTPUT === "json") print(EJSON.stringify(output));
  else printjson(output);
})();
