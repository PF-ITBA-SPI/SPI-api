'use strict'

const mongoose = require('mongoose')
require('../models/Sample') // Register model
const Sample = mongoose.model('Sample')

module.exports = {
  create: async (req, res) => {
    const params = Object.assign({}, req.body, { buildingId: req.params.buildingId })
    const sample = new Sample(params)
    try {
      await sample.save()
      res.status(201).json({ message: 'Sample successfully created' })
    } catch (err) {
      res.status(400).json(err)
    }
  },

  list: async (req, res) => {
    const query = Sample.find({ buildingID: req.params.buildingId })

    query.lean()

    try {
      const samples = await query.exec()

      if (samples === null) {
        return res.status(404).json({})
      }

      res.json(samples)
    } catch (err) {
      res.status(400).json(err)
    }
  },

  get: async (req, res) => {
    const query = Sample.findById(req.params.id)

    query.lean()

    try {
      const sample = await query.exec()

      if (sample === null) {
        return res.status(404).json({})
      }

      res.json(sample)
    } catch (err) {
      res.status(400).json(err)
    }
  },

  delete: async (req, res) => {
    const query = Sample.remove({ _id: req.params.id })

    try {
      const err = await query.exec()

      if (err) {
        return res.json(err)
      }

      res.json({ message: 'Sample successfully deleted' })
    } catch (err) {
      res.status(400).json(err)
    }
  },

  deleteAll: async (req, res) => {
    const query = Sample.remove({ buildingID: req.params.buildingId })

    try {
      const err = await query.exec()

      if (err) {
        return res.json(err)
      }

      res.json({ message: `All samples for building ${req.params.buildingId} successfully deleted` })
    } catch (err) {
      res.status(400).json(err)
    }
  }
}