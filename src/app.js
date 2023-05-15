const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { getProfile } = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)
const { Op } = require('sequelize');

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params
    const contract = await Contract.findOne({ where: { id } })
    if (!contract) return res.status(404).end()
    if (req.profile.type == 'client')
        if (contract.ClientId != req.get('profile_id'))
            return res.status(404).end()
        else if (req.profile.type == 'contractor')
            if (contract.ContractorId != req.get('profile_id'))
                return res.status(404).end()


    res.json(contract)
})

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    let contracts = [];
    if (req.profile.type == 'client')
        contracts = await Contract.findAll({ where: { ClientId: req.profile.id } });
    if (req.profile.type == 'contractor')
        contracts = await Contract.findAll({ where: { ContractorId: req.profile.id } });

    if (!contracts) {
        return res.status(404).end();
    }
    const filteredContracts = contracts.filter(contract => contract.status == 'new' || contract.status == 'in_progress');


    res.json(filteredContracts);
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Contract, Job } = req.app.get('models');
    const profile = req.profile;
    try {
        const contracts = await Contract.findAll({
            where: {
                [Op.or]: [
                    { ClientId: profile.id },
                    { ContractorId: profile.id }
                ],
                status: 'in_progress' || 'new'
            },
            include: [{
                model: Job,
                where: {
                    [Op.or]: [
                        { paid: false },
                        { paid: { [Op.is]: null } }
                    ]
                }
            }]
        });

        const unpaidJobs = contracts.reduce((jobs, contract) => {
            jobs.push(...contract.Jobs);
            return jobs;
        }, []);

        res.json(unpaidJobs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { job_id } = req.params;
  console.log("hey");
    const job = await Job.findOne({ where: { id: job_id, paid: false || null } });
    console.log(job);
    if (!job) return res.status(404).end();
  
    const contract = await Contract.findOne({
      where: { id: job.ContractId, status: { [Op.in]: ['new', 'in_progress'] } }
    });
    if (!contract) return res.status(404).end();
  
    const clientProfile = await Profile.findByPk(contract.ClientId);
    const contractorProfile = await Profile.findByPk(contract.ContractorId);
    if (!clientProfile || !contractorProfile) return res.status(404).end();
    console.log(clientProfile);

    if (clientProfile.balance >= job.price) {
      // Update balances
      clientProfile.balance -= job.price;
      contractorProfile.balance += job.price;
  
      // Set job as paid
      job.paid = true;
      job.paymentDate = new Date();
  
      // Save changes
      await clientProfile.save();
      await contractorProfile.save();
      await job.save();
    console.log(clientProfile);
      res.json({ message: 'Payment successful' });
    } else {
      res.status(400).json({ error: 'Insufficient balance' });
    }
  });

  app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { Profile, Job } = req.app.get('models');
    const { userId } = req.params;
    const { amount } = req.body;
  
    // Find the client profile
    const clientProfile = await Profile.findOne({ where: { id: userId, type: 'client' } });
    if (!clientProfile) {
      return res.status(404).json({ error: 'Client profile not found' });
    }
  
    // Calculate the maximum deposit amount allowed (25% of total jobs to pay)
    const totalJobsToPay = await Job.sum('price', {
      where: {
        ContractId: userId,
        paid: false
      }
    });
    const maxDepositAmount = totalJobsToPay * 0.25;
  
    // Check if the deposit amount exceeds the maximum allowed
    if (amount > maxDepositAmount) {
      return res.status(400).json({ error: 'Deposit amount exceeds the maximum allowed' });
    }
  
    // Update the client's balance by depositing the amount
    clientProfile.balance += amount;
    await clientProfile.save();
  
    res.json({ message: 'Deposit successful' });
  });

  app.get('/admin/best-profession', async (req, res) => {
    const { Job, Profile } = req.app.get('models');
    const { start, end } = req.query;
  
    // Validate and parse the start and end dates
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ error: 'Invalid start or end date' });
    }
  
    // Find the best profession based on the sum of jobs paid within the time range
    const result = await Job.findAll({
      attributes: [
        'Contract.ContractorId',
        [sequelize.fn('SUM', sequelize.col('price')), 'totalPaid']
      ],
      include: [
        {
          model: Profile,
          as: 'Contract',
          attributes: [],
          where: {
            type: 'contractor'
          }
        }
      ],
      where: {
        paid: true,
        paymentDate: {
          [Op.between]: [startDate, endDate]
        }
      },
      group: ['Contract.ContractorId'],
      order: [[sequelize.fn('SUM', sequelize.col('price')), 'DESC']],
      limit: 1
    });
  
    if (result.length === 0) {
      return res.status(404).json({ error: 'No data found within the specified time range' });
    }
  
    const bestProfession = await Profile.findOne({ where: { id: result[0].Contract.ContractorId } });
    res.json({ bestProfession: bestProfession.profession, totalPaid: result[0].totalPaid });
  });
  
  app.get('/admin/best-clients', async (req, res) => {
    const { start, end, limit } = req.query;
    const { Job,Profile,Contract } = req.app.get('models')

  
    // Set default limit to 2 if not provided
    const limitValue = parseInt(limit) || 2;
  
    // Query the database to get the clients who paid the most for jobs within the specified time period
    const result = await Job.findAll({
      attributes: [
        'ClientId',
        [sequelize.fn('SUM', sequelize.col('price')), 'paid']
      ],
      where: {
        paid: true,
        paymentDate: {
          [Op.between]: [start, end]
        }
      },
      group: ['ClientId'],
      order: [[sequelize.literal('paid'), 'DESC']],
      limit: limitValue,
      include: [
        {
          model: Profile,
          attributes: ['id', [sequelize.literal('CONCAT(firstName, " ", lastName)'), 'fullName']]
        }
      ]
    });
  
    // Format the result data
    const formattedResult = result.map((row) => ({
      id: row.Profile.id,
      fullName: row.Profile.fullName,
      paid: row.dataValues.paid
    }));
  
    res.json(formattedResult);
  });
  
module.exports = app;
