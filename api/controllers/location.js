'use strict'

const mongoose = require('mongoose')
require('../models/Sample') // Register model
const Sample = mongoose.model('Sample')
require('express-csv')

const DEFAULT_RSSI = parseInt(process.env.DEFAULT_RSSI, 10)
const K1 = parseInt(process.env.K1, 10)
const K2 = parseInt(process.env.K2, 10)
const M = parseInt(process.env.M, 10)
const N = parseInt(process.env.N, 10)

module.exports = {
  getLocation: async (req, res) => {
    const query = Sample.find({})
    query.lean()

    try {
      const samples = await query.exec()

      if (samples === null) {
        return res.status(404)
      }
      res.json(calculateLocation(samples, req.body))
    } catch (err) {
      res.status(400).json(err)
    }
  },

  getLocationFilteringSample: async (req, res) => {
    const query = Sample.find({})
    query.lean()

    try {
      const samples = await query.exec()
      if (samples === null) {
        return res.status(404)
      }
      const filteredSampleId = req.params.sampleId
      const location = calculateLocationFilteringSample(samples, filteredSampleId)
      if (location === -1) {
        res.status(404).send('Sample not found')
      } else {
        res.json(location)
      }
    } catch (err) {
      res.status(400).json(err)
    }
  },

  getLocationError: async (req, res) => {
    const query = Sample.find({ fingerprint: { '$ne': {} } }) // With at least one fingerprint
    query.lean()

    try {
      // Read query parameters, fall back to defaults, and parse to int (since we receive query params as strings)
      const k1Values = parseOptionalNumberCollectionQueryParam(req.query, 'k1', K1) // [2, 4, 6, 8, 10]
      const k2Values = parseOptionalNumberCollectionQueryParam(req.query, 'k2', K2) // [2, 4, 6, 8, 10]
      const mValues = parseOptionalNumberCollectionQueryParam(req.query, 'floorAPNumber', M) // [1, 2, 3, 4, 5, 6]
      const nValues = parseOptionalNumberCollectionQueryParam(req.query, 'minSamplesForPosition', N) // [1, 3, 5]
      const defaultRSSIValues = parseOptionalNumberCollectionQueryParam(req.query, 'defaultRSSI', DEFAULT_RSSI) // [0]

      const samples = await query.exec()
      // const samples = require('C:\\Users\\juan_\\Desktop\\samples.json')
      //   .filter(s => Object.entries(s.fingerprint).length > 0)
      //   .map(entry => {
      //     ['_id', 'buildingId', 'floorId'].forEach(key => {
      //       if (entry.hasOwnProperty(key)) {
      //         entry[key] = new mongoose.Types.ObjectId(entry[key]); // Convert to ObjectId
      //       }
      //     })
      //     return entry
      //   })
      if (samples === null) {
        return res.status(404)
      }
      // TODO rewrite this as a recursive function instead of 5 nested for
      let result = []
      k1Values.forEach((k1) => {
        k2Values.forEach((k2) => {
          mValues.forEach((m) => {
            nValues.forEach((n) => {
              defaultRSSIValues.forEach((defaultRSSI) => {
                console.log(`Calculating error for ${samples.length} samples with K1 = ${k1}, K2 = ${k2}, floorAPNumber (M) = ${m}, minSamplesForPosition (N) = ${n}, defaultRSSI = ${defaultRSSI}...`)
                const run = calculateLocationsError(samples, defaultRSSI, k1, k2, m, n)
                result.push(run)
              })
            })
          })
        })
      })
      console.log('DONE WITH ALL RUNS')
      return req.get('accept') === 'text/csv' ? res.csv(toCsv(result)) : res.json(result)
    } catch (err) {
      console.error(err)
      res.status(400).json(err)
    }
  },
}

function calculateLocationsError (samples, defaultRSSI = DEFAULT_RSSI, k1 = K1, k2 = K2, m = M, n = N) {
  const entries = {}
  samples.forEach((sample) => {
    const filteredSampleId = sample._id
    const location = calculateLocationFilteringSample(samples, filteredSampleId, defaultRSSI, k1, k2, m, n)
    if (location.latitude !== null && location.longitude !== null && location.buildingId != null && location.floorId !== null) {
      entries[filteredSampleId] = {
        distance: getDistanceFromLatLonInKm(location.latitude, location.longitude, sample.latitude, sample.longitude) * 1000,
        buildingId: location.buildingId,
        realBuildingId: location.realBuildingId,
        correctBuilding: location.correctBuilding,
        floorId: location.floorId,
        realFloorId: location.realFloorId,
        correctFloor: location.correctFloor,
      }
    } else {
      // Sample was not located anywhere
      entries[filteredSampleId] = {
        distance: null,
        buildingId: null,
        realBuildingId: null,
        correctBuilding: false,
        floorId: null,
        realFloorId: null,
        correctFloor: false,
      }
    }
  })

  const resultValues = Object.values(entries)
  const filteredDistances = resultValues
    .map(entry => entry.distance)
    .filter(d => d !== null) // Exclude entries that weren't located

  return {
    entries,
    errorMean: filteredDistances.reduce((acc, current) => acc + current, 0) / filteredDistances.length,
    meanSquaredError: filteredDistances.reduce((acc, current) => acc + current * current, 0) / filteredDistances.length,
    correctBuildingPercentage: resultValues.reduce((acc, current) => acc + current.correctBuilding, 0) / resultValues.length,
    correctFloorPercentage: resultValues.reduce((acc, current) => acc + current.correctFloor, 0) / resultValues.length,
    notLocatedCount: resultValues.length - filteredDistances.length,
    k1,
    k2,
    floorAPNumber: m,
    minSamplesForPosition: n,
    defaultRSSI
  }
}

function getDistanceFromLatLonInKm (lat1, lon1, lat2, lon2) { // https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
  const R = 6371 // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1) // deg2rad below
  const dLon = deg2rad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c // Distance in km
}

function deg2rad (deg) {
  return deg * (Math.PI / 180)
}

function calculateLocationFilteringSample (samples, filteredSampleId, defaultRSSI = DEFAULT_RSSI, k1 = K1, k2 = K2, m = M, n = N) {
  const samplesCopy = [...samples]
  const filteredSampleIndex = samplesCopy.findIndex(sample => sample._id.equals(filteredSampleId))
  if (filteredSampleIndex === -1) {
    return -1
  }
  const filteredSample = samplesCopy.splice(filteredSampleIndex, 1)[0]
  const calculatedLocation = calculateLocation(samplesCopy, filteredSample.fingerprint, defaultRSSI, k1, k2, m, n)
  return {
    ...calculatedLocation,
    realBuildingId: filteredSample.buildingId,
    correctBuilding: (calculatedLocation.buildingId || '').toString() === filteredSample.buildingId.toString(),
    realFloorId: filteredSample.floorId,
    correctFloor: (calculatedLocation.floorId || '').toString() === filteredSample.floorId.toString(),
  }
}

function calculateLocation (samples, locationFingerprint, defaultRSSI = DEFAULT_RSSI, k1 = K1, k2 = K2, m = M, n = N) {
  // Do algorithm
  const mainFingerprintSortedSSIDsByRSSI = sortSSIDsByRSSI(locationFingerprint)
  samples.forEach(sample => {
    sample.sortedIdsByRSSI = sortSSIDsByRSSI(sample.fingerprint)
  })

  // Calculate the building:

  // Step 1: Take AP0, the strongest AP observed in fp0. // TODO take the top 3 strongest AP?
  // Step 2: Build R’, a subset of the radio map R, with all the samples where the strongest AP is AP0.
  // Step 3: If R’ is an empty set, repeat steps 1 and 2 for the 2nd, 3rd, ..., strongest AP in fp0.
  var R0
  for (let i = 0; i < mainFingerprintSortedSSIDsByRSSI.length; i++) {
    R0 = samples.filter(sample => sample.sortedIdsByRSSI[0] === mainFingerprintSortedSSIDsByRSSI[i])
    if (R0.length > 0) break
  }
  if (!R0.length) {
    return {
      latitude: null,
      longitude: null,
      buildingId: null,
      floorId: null,
    }
  }
  // Step 4: Count the number of samples in R’ associated to each building and set b to the most frequent building (majority rule).
  var mostFrequentBuilding = getMostFrequent(R0, 'buildingId')

  // Calculate the floor:

  // Strep 1: Build R’, a subset of R, with all the samples where the building is b (the building estimated in the previous step)
  let R1 = samples.filter(sample => sample.buildingId.equals(mostFrequentBuilding))
  // Strep 2: Build R’’, a subset of R’, with all the samples where the strongest AP is equal to AP0, AP1 or AP2 until APM, where M is a parameter.
  let R2 = R1.filter(sample => mainFingerprintSortedSSIDsByRSSI.slice(0, m).includes(sample.sortedIdsByRSSI[0]))
  // Step 3: TODO we are not doing this so we take it as if #(R'') is always big enough
  // If #(R’’) < n, then R’’ = R’, where #(.) denotes the cardinality of a set, and N is a parameter.
  if (R2.length <= n) R2 = R1
  // Step 4: Compute the similarity, the Manhattan distance, between the fingerprint given and all the fingerprints in R’’.
  R2.forEach(sample => { sample.similarity = manhattanDistance(sample.fingerprint, locationFingerprint, defaultRSSI) })
  // Step 5: Take the k1 samples in R’’ that are the most similar to fp0. (The ones with the smaller similarity, TODO check this)
  R2.sort((sample1, sample2) => sample1.similarity - sample2.similarity)
  var mostSimilarSamples = R2.slice(0, k1)
  // Step 6: Count the number of samples, from within the k1, associated to each floor, and set f to the most frequent floor (majority rule).
  var mostFrequentFloor = getMostFrequent(mostSimilarSamples, 'floorId')

  // Calculate the position:

  // Step 1: Build R’’’, a subset of R’’ (from the floor estimation procedure), with all the samples where the floor is f.
  let R3 = R2.filter(sample => sample.floorId.equals(mostFrequentFloor))
  // Step 2: Compute the similarity, S(), between fp0 and all then fingerprints in R’’’. But this was already done in floor step 4
  // Step 3:
  // Take the k2 samples in R’’’ that are the most similar to fp0.
  // The sorting is also already done in step 5 of floor selection TODO check if this is useless
  R3.sort((sample1, sample2) => sample1.similarity - sample2.similarity)
  mostSimilarSamples = R3.slice(0, k2)
  // Step 4: Compute the estimated coordinates as the centroid of the k2 samples.
  var position = getCentroid(mostSimilarSamples)
  position.floorId = mostFrequentFloor
  position.buildingId = mostFrequentBuilding

  return position
}

function getCentroid (samples) {
  var latitudeSum = 0
  var longitudeSum = 0
  samples.forEach(sample => {
    latitudeSum += sample.latitude
    longitudeSum += sample.longitude
  })
  return { latitude: latitudeSum / samples.length, longitude: longitudeSum / samples.length }
}

/*
  Return the SSIDs of the fingerprint sorted by their RSSI value in the fingerprint, from biggest to smallest
 */
function sortSSIDsByRSSI (fingerprint) {
  return Object.keys(fingerprint).sort((SSID1, SSID2) => fingerprint[SSID2] - fingerprint[SSID1])
}

function getMostFrequent (samples, key) {
  var elementsCount = {}
  var mostFrequent = ''
  var maxCount = 0
  for (let sample of samples) {
    if (elementsCount[sample[key]]) {
      elementsCount[sample[key]]++
    } else {
      elementsCount[sample[key]] = 1
    }
    if (maxCount < elementsCount[sample[key]]) {
      mostFrequent = sample[key]
      maxCount = elementsCount[sample[key]]
    }
  }
  return mostFrequent
}

function manhattanDistance (fingerprint1, fingerprint2, defaultRSSI) {
  var keysUnion = [...new Set([...Object.keys(fingerprint1), ...Object.keys(fingerprint2)])]
  var unionSize = keysUnion.length
  var intersectionSize = Object.keys(fingerprint1).length + Object.keys(fingerprint2).length - keysUnion.length
  var sumatorial = 0
  keysUnion.forEach(key => {
    var RSSI1 = fingerprint1[key] || defaultRSSI // TODO Check what happens if default RSSI is not 0 and if there are RSSI with 0 value
    var RSSI2 = fingerprint2[key] || defaultRSSI
    sumatorial += Math.abs(RSSI1 - RSSI2)
  })
  return sumatorial / unionSize - 2 * intersectionSize
}

/**
 * Read an optional query parameter that is a number array.  If present, parse every element as integer. Otherwise,
 * return one-element array with default value.
 *
 * @param queryParams {object} Express request query parameters from which to read.
 * @param paramName {string} Parameter name.
 * @param defaultValue {number} Default value.
 * @returns {number[]} Result.
 */
function parseOptionalNumberCollectionQueryParam (queryParams, paramName, defaultValue) {
  const value = queryParams[paramName]
  if (value) {
    return value.split(',').map(n => parseInt(n, 10))
  } else {
    return [defaultValue]
  }
}

/**
 * Preprocess data into nested arrays for CSV conversion.
 *
 * @param locationErrorResults {object[]} Results obtained from {@link calculateLocationsError}.
 * @returns {*[][]} Array of arrays, where each sub-array is a row. First row is headers.
 */
function toCsv (locationErrorResults) {
  // Headers first
  const result = [[
    'distance', 'buildingId', 'realBuildingId', 'correctBuilding', 'floorId', 'realFloorId', 'correctFloor', 'k1', 'k2', 'floorAPNumber', 'minSamplesForPosition', 'defaultRSSI',
  ]]
  // Now extract and denormalize data to allow CSV conversion
  return result.concat(locationErrorResults.flatMap(run =>
    Object.values(run.entries).map(entry =>
      [
        ...Object.values(entry),
        run.k1,
        run.k2,
        run.floorAPNumber,
        run.minSamplesForPosition,
        run.defaultRSSI
      ]
    )
  ))
}
