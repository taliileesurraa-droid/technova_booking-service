const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/analytics.controller');
const { authenticate, authorize } = require('../../middleware/auth');

// Dashboard Statistics - Admin only
router.get('/dashboard', authenticate, authorize('admin', 'superadmin'), ctrl.getDashboardStats);

// Revenue Reports - Admin only
router.get('/reports/daily', authenticate, authorize('admin', 'superadmin'), ctrl.getDailyReport);
router.get('/reports/weekly', authenticate, authorize('admin', 'superadmin'), ctrl.getWeeklyReport);
router.get('/reports/monthly', authenticate, authorize('admin', 'superadmin'), ctrl.getMonthlyReport);

// Driver Earnings Management
router.get('/earnings/driver', authenticate, authorize('driver', 'admin', 'superadmin'), ctrl.getDriverEarnings);

// Commission Management - Admin only
router.post('/commission', authenticate, authorize('admin', 'superadmin'), ctrl.setCommission);
router.get('/commission', authenticate, authorize('admin', 'superadmin'), ctrl.getCommission);

// Ride History - Available to drivers and passengers
router.get('/rides/history', authenticate, authorize('driver', 'passenger', 'admin', 'superadmin'), ctrl.getRideHistory);

// Trip History by User ID - For user service integration
router.get('/trips/history/:userType/:userId', ctrl.getTripHistoryByUserId);

// Finance Overview - Admin only
router.get('/finance/overview', authenticate, authorize('admin', 'superadmin'), ctrl.getFinanceOverview);

// Rewards endpoints
router.get('/rewards/passenger', authenticate, authorize('passenger','admin','superadmin'), ctrl.getPassengerRewards);
router.get('/rewards/driver', authenticate, authorize('driver','admin','superadmin'), ctrl.getDriverRewards);

module.exports = router;
