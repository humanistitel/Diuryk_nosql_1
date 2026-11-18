// Run from mongosh after selecting the database: load("queries/part2_queries.js").
// NOSQL_QUERY_OUTPUT=json emits all returned records for reproducible checks.
(() => {
  const tracks = db.getCollection("tracks");
  const card = {
    _id: 1, track_id: 1, track_name: 1, artists: 1,
    track_genre: 1, popularity: 1, duration_ms: 1
  };

  const partyFilter = {
    "audio_features.danceability": { $gt: 0.7 },
    "audio_features.energy": { $gt: 0.7 },
    duration_ms: { $gte: 180000, $lte: 300000 }
  };
  const partyFields = {
    ...card, "audio_features.danceability": 1, "audio_features.energy": 1
  };

  const artistPipeline = [
    { $unwind: "$artists" },
    { $match: { artists: { $type: "string", $ne: "" } } },
    // A track may occur in several genre rows. A low value never disappears.
    {
      $group: {
        _id: { artist: "$artists", track: "$track_id" },
        popularity: { $min: "$popularity" }
      }
    },
    {
      $group: {
        _id: "$_id.artist",
        track_count: { $sum: 1 },
        min_popularity: { $min: "$popularity" },
        average_unrounded: { $avg: "$popularity" }
      }
    },
    { $match: { track_count: { $gte: 3 }, min_popularity: { $gte: 60 } } },
    { $sort: { average_unrounded: -1, track_count: -1, _id: 1 } },
    { $limit: 20 },
    {
      $project: {
        _id: 0, artist: "$_id", track_count: 1, min_popularity: 1,
        avg_popularity: { $round: ["$average_unrounded", 1] }
      }
    }
  ];

  const tempoPipeline = [
    {
      $group: {
        _id: "$track_genre",
        avg_tempo: { $avg: "$audio_features.tempo" },
        tempo_stddev: { $stdDevPop: "$audio_features.tempo" }
      }
    },
    {
      $set: {
        outlier_threshold: {
          $add: ["$avg_tempo", { $multiply: [2, "$tempo_stddev"] }]
        }
      }
    },
    {
      $lookup: {
        from: "tracks",
        localField: "_id",
        foreignField: "track_genre",
        let: { threshold: "$outlier_threshold" },
        pipeline: [
          { $match: { $expr: { $gt: ["$audio_features.tempo", "$$threshold"] } } },
          { $sort: { "audio_features.tempo": -1, track_id: 1, _id: 1 } },
          { $project: { _id: 1, track_id: 1, track_name: 1, popularity: 1, artists: 1, "audio_features.tempo": 1 } }
        ],
        as: "outlier_tracks"
      }
    },
    { $project: { _id: 0, genre: "$_id", avg_tempo: 1, outlier_threshold: 1, outlier_tracks: 1 } },
    { $sort: { genre: 1 } }
  ];

  const focusFilter = {
    "audio_features.loudness": { $lt: -10 },
    "audio_features.speechiness": { $lt: 0.1 },
    "audio_features.instrumentalness": { $gt: 0.5 },
    explicit: false
  };
  const focusFields = {
    ...card, explicit: 1, "audio_features.loudness": 1,
    "audio_features.speechiness": 1, "audio_features.instrumentalness": 1
  };

  const sortTracks = { track_name: 1, track_id: 1, _id: 1 };
  const artists = tracks.aggregate(artistPipeline).toArray();
  const tempos = tracks.aggregate(tempoPipeline).toArray();
  if (process.env.NOSQL_QUERY_OUTPUT === "json") {
    print(EJSON.stringify({
      party: tracks.find(partyFilter, partyFields).sort(sortTracks).toArray(),
      artists,
      tempos,
      focus: tracks.find(focusFilter, focusFields).sort(sortTracks).toArray()
    }));
  } else {
    printjson({
      party: {
        count: tracks.countDocuments(partyFilter),
        sample: tracks.find(partyFilter, partyFields).sort(sortTracks).limit(5).toArray()
      },
      artists,
      tempos: {
        genre_count: tempos.length,
        outlier_count: tempos.reduce((total, row) => total + row.outlier_tracks.length, 0),
        sample: tempos.filter(row => row.outlier_tracks.length > 0).slice(0, 5).map(row => ({
          ...row, outlier_count: row.outlier_tracks.length, outlier_tracks: row.outlier_tracks.slice(0, 2)
        }))
      },
      focus: {
        count: tracks.countDocuments(focusFilter),
        sample: tracks.find(focusFilter, focusFields).sort(sortTracks).limit(5).toArray()
      }
    });
  }
})();
