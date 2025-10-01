function shape(item) {
  if (!item) return item;
  const obj = typeof item.toJSON === 'function' ? item.toJSON() : item;
  if (obj._id && !obj.id) obj.id = String(obj._id);
  delete obj._id;
  if (obj.password) delete obj.password;
  return obj;
}

exports.crudController = (Model) => ({
  create: async (req, res) => { 
    try { 
      const item = await Model.create(req.body); 
      return res.status(201).json(shape(item)); 
    } catch (e) { 
      return res.status(500).json({ message: `Failed to create ${Model.modelName}: ${e.message}` }); 
    } 
  },
  list: async (req, res) => { 
    try { 
      const items = await Model.find().sort({ createdAt: -1 }); 
      return res.json(items.map(shape)); 
    } catch (e) { 
      return res.status(500).json({ message: `Failed to retrieve ${Model.modelName} list: ${e.message}` }); 
    } 
  },
  get: async (req, res) => { 
    try { 
      const item = await Model.findById(req.params.id); 
      if (!item) return res.status(404).json({ message: `${Model.modelName} not found` }); 
      return res.json(shape(item)); 
    } catch (e) { 
      return res.status(500).json({ message: `Failed to retrieve ${Model.modelName}: ${e.message}` }); 
    } 
  },
  update: async (req, res) => { 
    try { 
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true }); 
      if (!item) return res.status(404).json({ message: `${Model.modelName} not found` }); 
      return res.json(shape(item)); 
    } catch (e) { 
      return res.status(500).json({ message: `Failed to update ${Model.modelName}: ${e.message}` }); 
    } 
  },
  remove: async (req, res) => { 
    try { 
      const r = await Model.findByIdAndDelete(req.params.id); 
      if (!r) return res.status(404).json({ message: `${Model.modelName} not found` }); 
      return res.status(204).send(); 
    } catch (e) { 
      return res.status(500).json({ message: `Failed to delete ${Model.modelName}: ${e.message}` }); 
    } 
  },
});

