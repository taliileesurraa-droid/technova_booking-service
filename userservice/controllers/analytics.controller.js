const dayjs = require('dayjs');
const { Booking, TripHistory } = require('../models/bookingModels');
const { Driver, Passenger } = require('../models/userModels');
const { Commission, DriverEarnings, AdminEarnings, Payout } = require('../models/commission');
const { DailyReport, WeeklyReport, MonthlyReport, Complaint } = require('../models/analytics');

// Dashboard Statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const today = dayjs().startOf('day').toDate();
    const thisWeek = dayjs().startOf('week').toDate();
    const thisMonth = dayjs().startOf('month').toDate();

    // Total counts
    const totalRides = await Booking.countDocuments();
    const totalEarnings = await Booking.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);
    const totalUsers = await Passenger.countDocuments();
    const totalDrivers = await Driver.countDocuments();
    const totalCars = await Driver.countDocuments();
    const totalComplaints = await Complaint.countDocuments();

    // Today's stats
    const todayRides = await Booking.countDocuments({
      createdAt: { $gte: today }
    });
    const todayEarnings = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // This week's stats
    const weekRides = await Booking.countDocuments({
      createdAt: { $gte: thisWeek }
    });
    const weekEarnings = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: thisWeek } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // This month's stats
    const monthRides = await Booking.countDocuments({
      createdAt: { $gte: thisMonth }
    });
    const monthEarnings = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: thisMonth } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // Commission stats
    const totalCommission = await AdminEarnings.aggregate([
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);

    // Pending payouts
    const pendingPayouts = await Payout.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$netPayout' } } }
    ]);

    res.json({
      overview: {
        totalRides,
        totalEarnings: totalEarnings[0]?.total || 0,
        totalUsers,
        totalDrivers,
        totalCars,
        totalComplaints,
        totalCommission: totalCommission[0]?.total || 0,
        pendingPayouts: pendingPayouts[0]?.total || 0
      },
      today: {
        rides: todayRides,
        earnings: todayEarnings[0]?.total || 0
      },
      thisWeek: {
        rides: weekRides,
        earnings: weekEarnings[0]?.total || 0
      },
      thisMonth: {
        rides: monthRides,
        earnings: monthEarnings[0]?.total || 0
      }
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get dashboard stats: ${e.message}` });
  }
};

// Revenue Reports
exports.getDailyReport = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? dayjs(date).startOf('day').toDate() : dayjs().startOf('day').toDate();
    const nextDay = dayjs(targetDate).add(1, 'day').toDate();

    // Get or create daily report
    let report = await DailyReport.findOne({ date: targetDate });
    
    if (!report) {
      // Generate report for the day
      const rides = await Booking.find({
        createdAt: { $gte: targetDate, $lt: nextDay }
      }).populate('driverId passengerId');

      const totalRevenue = rides
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.fareFinal || r.fareEstimated), 0);

      const totalCommission = await AdminEarnings.aggregate([
        { $match: { tripDate: { $gte: targetDate, $lt: nextDay } } },
        { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
      ]);

      const completedCountD = rides.filter(r => r.status === 'completed').length;
      const avgFareD = completedCountD > 0 ? totalRevenue / completedCountD : 0;
      report = await DailyReport.create({
        date: targetDate,
        totalRides: rides.length,
        totalRevenue,
        totalCommission: totalCommission[0]?.total || 0,
        completedRides: completedCountD,
        canceledRides: rides.filter(r => r.status === 'canceled').length,
        averageFare: Number.isFinite(avgFareD) ? avgFareD : 0,
        rideDetails: rides.map(r => ({
          bookingId: r._id,
          driverId: r.driverId,
          passengerId: r.passengerId,
          fare: r.fareFinal || r.fareEstimated,
          commission: (r.fareFinal || r.fareEstimated) * 0.15, // Default 15% commission
          status: r.status,
          vehicleType: r.vehicleType,
          distanceKm: r.distanceKm
        }))
      });
    }

    res.json(report);
  } catch (e) {
    res.status(500).json({ message: `Failed to get daily report: ${e.message}` });
  }
};

exports.getWeeklyReport = async (req, res) => {
  try {
    const { weekStart } = req.query;
    const startDate = weekStart ? dayjs(weekStart).startOf('week').toDate() : dayjs().startOf('week').toDate();
    const endDate = dayjs(startDate).endOf('week').toDate();

    let report = await WeeklyReport.findOne({ weekStart: startDate });
    
    if (!report) {
      // Generate weekly report
      const rides = await Booking.find({
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalRevenue = rides
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.fareFinal || r.fareEstimated), 0);

      const totalCommission = await AdminEarnings.aggregate([
        { $match: { tripDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
      ]);

      const completedCount = rides.filter(r => r.status === 'completed').length;
      const avgFare = completedCount > 0 ? totalRevenue / completedCount : 0;
      report = await WeeklyReport.create({
        weekStart: startDate,
        weekEnd: endDate,
        totalRides: rides.length,
        totalRevenue,
        totalCommission: totalCommission[0]?.total || 0,
        completedRides: completedCount,
        canceledRides: rides.filter(r => r.status === 'canceled').length,
        averageFare: Number.isFinite(avgFare) ? avgFare : 0
      });
    }

    res.json(report);
  } catch (e) {
    res.status(500).json({ message: `Failed to get weekly report: ${e.message}` });
  }
};

exports.getMonthlyReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const targetMonth = month ? parseInt(month) : dayjs().month() + 1;
    const targetYear = year ? parseInt(year) : dayjs().year();
    const startDate = dayjs().month(targetMonth - 1).year(targetYear).startOf('month').toDate();
    const endDate = dayjs().month(targetMonth - 1).year(targetYear).endOf('month').toDate();

    let report = await MonthlyReport.findOne({ month: targetMonth, year: targetYear });
    
    if (!report) {
      // Generate monthly report
      const rides = await Booking.find({
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalRevenue = rides
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.fareFinal || r.fareEstimated), 0);

      const totalCommission = await AdminEarnings.aggregate([
        { $match: { tripDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
      ]);

      const completedCountM = rides.filter(r => r.status === 'completed').length;
      const avgFareM = completedCountM > 0 ? totalRevenue / completedCountM : 0;
      report = await MonthlyReport.create({
        month: targetMonth,
        year: targetYear,
        totalRides: rides.length,
        totalRevenue,
        totalCommission: totalCommission[0]?.total || 0,
        completedRides: completedCountM,
        canceledRides: rides.filter(r => r.status === 'canceled').length,
        averageFare: Number.isFinite(avgFareM) ? avgFareM : 0
      });
    }

    res.json(report);
  } catch (e) {
    res.status(500).json({ message: `Failed to get monthly report: ${e.message}` });
  }
};

// Driver Earnings Management
exports.getDriverEarnings = async (req, res) => {
  try {
    const { driverId, period, startDate, endDate } = req.query;
    const driverIdFilter = driverId || req.user.id;

    let dateFilter = {};
    if (period === 'daily') {
      const today = dayjs().startOf('day').toDate();
      const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();
      dateFilter = { tripDate: { $gte: today, $lt: tomorrow } };
    } else if (period === 'weekly') {
      const weekStart = dayjs().startOf('week').toDate();
      const weekEnd = dayjs().endOf('week').toDate();
      dateFilter = { tripDate: { $gte: weekStart, $lte: weekEnd } };
    } else if (period === 'monthly') {
      const monthStart = dayjs().startOf('month').toDate();
      const monthEnd = dayjs().endOf('month').toDate();
      dateFilter = { tripDate: { $gte: monthStart, $lte: monthEnd } };
    } else if (startDate && endDate) {
      dateFilter = { tripDate: { $gte: new Date(startDate), $lte: new Date(endDate) } };
    }

    let earnings = await DriverEarnings.find({
      driverId: String(driverIdFilter),
      ...dateFilter
    }).populate('bookingId').sort({ tripDate: -1 });
    // Only include completed bookings
    earnings = earnings.filter(e => e.bookingId && e.bookingId.status === 'completed');

    const summary = await DriverEarnings.aggregate([
      { $match: { driverId: String(driverIdFilter), ...dateFilter } },
      { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
      { $unwind: '$booking' },
      { $match: { 'booking.status': 'completed' } },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalFareCollected: { $sum: '$grossFare' },
          totalCommissionDeducted: { $sum: '$commissionAmount' },
          netEarnings: { $sum: '$netEarnings' }
        }
      }
    ]);

    // Integrate wallet balance
    let walletBalance = 0;
    try {
      const { Wallet } = require('../models/common');
      const wallet = await Wallet.findOne({ userId: String(driverIdFilter), role: 'driver' }).lean();
      walletBalance = wallet ? wallet.balance : 0;
    } catch (_) {}

    res.json({
      summary: summary[0] || {
        totalRides: 0,
        totalFareCollected: 0,
        totalCommissionDeducted: 0,
        netEarnings: 0
      },
      wallet: { balance: walletBalance },
      earnings
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get driver earnings: ${e.message}` });
  }
};

// Commission Management
exports.setCommission = async (req, res) => {
  try {
    const { driverId, percentage, description } = req.body;
    const adminId = req.user.id;

    if (percentage < 0 || percentage > 100) {
      return res.status(400).json({ message: 'Commission percentage must be between 0 and 100' });
    }

    if (!driverId) {
      return res.status(400).json({ message: 'driverId is required to set commission' });
    }

    // Create driver-specific commission entry (latest wins)
    const commission = await Commission.create({
      driverId: String(driverId),
      percentage,
      description,
      createdBy: adminId
    });

    res.json(commission);
  } catch (e) {
    res.status(500).json({ message: `Failed to set commission: ${e.message}` });
  }
};

exports.getCommission = async (req, res) => {
  try {
    const driverId = req.query.driverId || req.params.driverId || req.user?.id;
    if (!driverId) {
      return res.json({ percentage: Number(process.env.COMMISSION_RATE || 15) });
    }
    const commission = await Commission.findOne({ driverId: String(driverId) }).sort({ createdAt: -1 });
    res.json(commission || { percentage: Number(process.env.COMMISSION_RATE || 15) });
  } catch (e) {
    res.status(500).json({ message: `Failed to get commission: ${e.message}` });
  }
};

// Ride History
exports.getRideHistory = async (req, res) => {
  try {
    const userType = req.user.type;
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    let query = {};
    if (userType === 'driver') {
      query.driverId = userId;
    } else if (userType === 'passenger') {
      query.passengerId = userId;
    }

    if (status) {
      query.status = status;
    }

    const rides = await Booking.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // enrich driver basic info via external service using externalId when present
    const { getDriversByIds } = require('../integrations/userServiceClient');
    const driverExternalIds = [...new Set(rides.map(r => r.driverId).filter(Boolean))].map(String);
    let driverInfoMap = {};
    if (driverExternalIds.length) {
      try {
        const infos = await getDriversByIds(driverExternalIds, req.headers.authorization);
        driverInfoMap = Object.fromEntries(infos.map(i => [String(i.id), { id: String(i.id), name: i.name, phone: i.phone }]));
      } catch (_) {}
    }

    const total = await Booking.countDocuments(query);

    const data = rides.map(r => ({
      ...r,
      driver: r.driverId ? driverInfoMap[String(r.driverId)] : undefined
    }));

    res.json({
      rides: data,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get ride history: ${e.message}` });
  }
};

// Get trip history by user ID (for user service integration)
exports.getTripHistoryByUserId = async (req, res) => {
  try {
    const { userType, userId } = req.params;
    const { status } = req.query;

    if (!userType || !userId) {
      return res.status(400).json({ message: 'userType and userId are required' });
    }

    if (userType !== 'driver' && userType !== 'passenger') {
      return res.status(400).json({ message: 'userType must be either driver or passenger' });
    }

    let query = {};
    if (userType === 'driver') {
      query.driverId = userId;
    } else if (userType === 'passenger') {
      query.passengerId = userId;
    }

    if (status) {
      query.status = status;
    }

    const trips = await Booking.find(query).sort({ createdAt: -1 }).lean();

    const { getDriversByIds } = require('../integrations/userServiceClient');
    const driverExternalIds = [...new Set(trips.map(r => r.driverId).filter(Boolean))].map(String);
    let driverInfoMap = {};
    if (driverExternalIds.length) {
      try {
        const infos = await getDriversByIds(driverExternalIds, req.headers.authorization);
        driverInfoMap = Object.fromEntries(infos.map(i => [String(i.id), { id: String(i.id), name: i.name, phone: i.phone }]));
      } catch (_) {}
    }

    const data = trips.map(t => ({
      ...t,
      driver: t.driverId ? driverInfoMap[String(t.driverId)] : undefined
    }));

    res.json({ trips: data });
  } catch (e) {
    res.status(500).json({ message: `Failed to get trip history: ${e.message}` });
  }
};

// Finance Overview
exports.getFinanceOverview = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    
    let dateFilter = {};
    if (period === 'daily') {
      const today = dayjs().startOf('day').toDate();
      const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();
      dateFilter = { tripDate: { $gte: today, $lt: tomorrow } };
    } else if (period === 'weekly') {
      const weekStart = dayjs().startOf('week').toDate();
      const weekEnd = dayjs().endOf('week').toDate();
      dateFilter = { tripDate: { $gte: weekStart, $lte: weekEnd } };
    } else if (period === 'monthly') {
      const monthStart = dayjs().startOf('month').toDate();
      const monthEnd = dayjs().endOf('month').toDate();
      dateFilter = { tripDate: { $gte: monthStart, $lte: monthEnd } };
    }

    // Total revenue
    const totalRevenue = await Booking.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // Commission earned
    const commissionEarned = await AdminEarnings.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);

    // Pending payouts
    const pendingPayouts = await Payout.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$netPayout' } } }
    ]);

    // Top earning drivers
    const topDrivers = await DriverEarnings.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$driverId',
          totalEarnings: { $sum: '$netEarnings' },
          totalRides: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 }
    ]);

    // Most profitable routes (by distance)
    const profitableRoutes = await Booking.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      {
        $group: {
          _id: {
            pickupLat: { $round: ['$pickup.latitude', 2] },
            pickupLng: { $round: ['$pickup.longitude', 2] },
            dropoffLat: { $round: ['$dropoff.latitude', 2] },
            dropoffLng: { $round: ['$dropoff.longitude', 2] }
          },
          totalRevenue: { $sum: '$fareFinal' },
          rideCount: { $sum: 1 },
          avgFare: { $avg: '$fareFinal' }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ]);

    // Wallet aggregates
    let walletTotals = { totalDriverBalances: 0, totalPassengerBalances: 0 };
    try {
      const { Wallet } = require('../models/common');
      const driverAgg = await Wallet.aggregate([
        { $match: { role: 'driver' } },
        { $group: { _id: null, total: { $sum: '$balance' } } }
      ]);
      const passengerAgg = await Wallet.aggregate([
        { $match: { role: 'passenger' } },
        { $group: { _id: null, total: { $sum: '$balance' } } }
      ]);
      walletTotals.totalDriverBalances = driverAgg[0]?.total || 0;
      walletTotals.totalPassengerBalances = passengerAgg[0]?.total || 0;
    } catch (_) {}

    res.json({
      totalRevenue: totalRevenue[0]?.total || 0,
      commissionEarned: commissionEarned[0]?.total || 0,
      pendingPayouts: pendingPayouts[0]?.total || 0,
      wallet: walletTotals,
      topEarningDrivers: topDrivers,
      mostProfitableRoutes: profitableRoutes
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get finance overview: ${e.message}` });
  }
};

// Rewards: 10 ETB per 2km of completed rides
async function computeRewardsForUser(userType, userId) {
  const match = { status: 'completed' };
  if (userType === 'driver') match.driverId = String(userId);
  if (userType === 'passenger') match.passengerId = String(userId);

  const agg = await Booking.aggregate([
    { $match: match },
    { $group: { _id: null, totalKm: { $sum: '$distanceKm' }, rides: { $sum: 1 } } }
  ]);

  const totalDistanceKm = agg[0]?.totalKm || 0;
  const completedRides = agg[0]?.rides || 0;
  const rewardPoints = Math.floor(totalDistanceKm / 2) * 10; // 10 ETB per 2km
  return { totalDistanceKm, completedRides, rewardPoints };
}

exports.getPassengerRewards = async (req, res) => {
  try {
    const passengerId = req.query.passengerId || req.user.id;
    const out = await computeRewardsForUser('passenger', passengerId);
    res.json({
      passengerId: String(passengerId),
      rule: '10 ETB per 2km of completed trips',
      ...out
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to compute passenger rewards: ${e.message}` });
  }
};

exports.getDriverRewards = async (req, res) => {
  try {
    const driverId = req.query.driverId || req.user.id;
    const out = await computeRewardsForUser('driver', driverId);
    res.json({
      driverId: String(driverId),
      rule: '10 ETB per 2km of completed trips',
      ...out
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to compute driver rewards: ${e.message}` });
  }
};
