import httpStatus from "http-status";
import {
	ApplicationStatus,
	ContractStatus,
	DisputeStatus,
	EventStatus,
	PaymentStatus,
	ProposalStatus,
	RefundStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";

const getAdminAnalytics = async () => {
	// total clients
	const totalClients = await prisma.client.count();

	// professionals
	const totalProfessionals = await prisma.professional.count({
		where: { isDeleted: false },
	});

	const totalPendingProfessionalApplications = await prisma.professional.count({
		where: { isDeleted: false, status: ApplicationStatus.PENDING },
	});

	const totalApprovedProfessionals = await prisma.professional.count({
		where: { isDeleted: false, status: ApplicationStatus.APPROVED },
	});

	const totalRejectedProfessionals = await prisma.professional.count({
		where: { isDeleted: false, status: ApplicationStatus.REJECTED },
	});

	// events
	const totalEvents = await prisma.event.count({
		where: { isDeleted: false },
	});

	// contracts
	const totalContracts = await prisma.contract.count();

	const totalCompletedContracts = await prisma.contract.count({
		where: { status: ContractStatus.COMPLETED },
	});

	const totalCancelledContracts = await prisma.contract.count({
		where: { status: ContractStatus.CANCELLED },
	});

	// disputes
	const totalDisputes = await prisma.dispute.count();

	const totalOpenDisputes = await prisma.dispute.count({
		where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } },
	});

	// revenue
	// Gross is every taka that came in: money that was released to the
	// professionals, money the platform still holds in escrow and money that
	// was refunded. The net revenue is what was actually released.
	const totalRevenueResult = await prisma.payment.aggregate({
		where: {
			status: {
				in: [
					PaymentStatus.ESCROWED,
					PaymentStatus.COMPLETED,
					PaymentStatus.REFUNDED,
				],
			},
		},
		_sum: { amount: true },
	});

	const totalRevenue = totalRevenueResult._sum.amount?.toNumber() || 0;

	const totalRefundedResult = await prisma.payment.aggregate({
		where: { status: PaymentStatus.REFUNDED },
		_sum: { amount: true },
	});

	const totalRefunded = totalRefundedResult._sum.amount?.toNumber() || 0;

	// money the platform holds until the contract is completed
	const totalEscrowedResult = await prisma.payment.aggregate({
		where: { status: PaymentStatus.ESCROWED },
		_sum: { amount: true },
	});

	const totalEscrowed = totalEscrowedResult._sum.amount?.toNumber() || 0;

	const netRevenue = totalRevenue - totalRefunded - totalEscrowed;

	// refunds that are recorded but not settled yet
	const totalPendingRefundsResult = await prisma.refund.aggregate({
		where: {
			status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
		},
		_sum: { amount: true },
	});

	const totalPendingRefunds =
		totalPendingRefundsResult._sum.amount?.toNumber() || 0;

	return {
		totalClients,
		totalProfessionals,
		totalPendingProfessionalApplications,
		totalApprovedProfessionals,
		totalRejectedProfessionals,
		totalEvents,
		totalContracts,
		totalCompletedContracts,
		totalCancelledContracts,
		totalDisputes,
		totalOpenDisputes,
		totalRevenue,
		totalRefunded,
		totalEscrowed,
		totalPendingRefunds,
		netRevenue,
	};
};

const getClientAnalytics = async (user: RequestUser) => {
	const client = await prisma.client.findUnique({
		where: { userId: user.userId },
	});

	if (!client) {
		throw new AppError(httpStatus.NOT_FOUND, "Client Profile Not Found");
	}

	const totalEvents = await prisma.event.count({
		where: { clientId: client.id, isDeleted: false },
	});

	const activeEvents = await prisma.event.count({
		where: {
			clientId: client.id,
			isDeleted: false,
			status: { in: [EventStatus.PUBLISHED, EventStatus.IN_PROGRESS] },
		},
	});

	const completedEvents = await prisma.event.count({
		where: {
			clientId: client.id,
			isDeleted: false,
			status: EventStatus.COMPLETED,
		},
	});

	const totalContracts = await prisma.contract.count({
		where: { clientId: client.id },
	});

	const activeContracts = await prisma.contract.count({
		where: {
			clientId: client.id,
			status: { in: [ContractStatus.CONFIRMED, ContractStatus.IN_PROGRESS] },
		},
	});

	const completedContracts = await prisma.contract.count({
		where: { clientId: client.id, status: ContractStatus.COMPLETED },
	});

	const cancelledContracts = await prisma.contract.count({
		where: { clientId: client.id, status: ContractStatus.CANCELLED },
	});

	// what the client paid: money that was released plus money the platform
	// still holds in escrow
	const totalAmountSpentResult = await prisma.payment.aggregate({
		where: {
			clientId: client.id,
			status: { in: [PaymentStatus.ESCROWED, PaymentStatus.COMPLETED] },
		},
		_sum: { amount: true },
	});

	const totalAmountSpent = totalAmountSpentResult._sum.amount?.toNumber() || 0;

	const totalRefundedResult = await prisma.payment.aggregate({
		where: { clientId: client.id, status: PaymentStatus.REFUNDED },
		_sum: { amount: true },
	});

	const totalRefunded = totalRefundedResult._sum.amount?.toNumber() || 0;

	const totalInEscrowResult = await prisma.payment.aggregate({
		where: { clientId: client.id, status: PaymentStatus.ESCROWED },
		_sum: { amount: true },
	});

	const totalInEscrow = totalInEscrowResult._sum.amount?.toNumber() || 0;

	const totalPendingRefundsResult = await prisma.refund.aggregate({
		where: {
			clientId: client.id,
			status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
		},
		_sum: { amount: true },
	});

	const totalPendingRefunds =
		totalPendingRefundsResult._sum.amount?.toNumber() || 0;

	const totalDisputesRaised = await prisma.dispute.count({
		where: { raisedById: user.userId },
	});

	const totalReviewsGiven = await prisma.review.count({
		where: { clientId: client.id, reviewByClient: true },
	});

	return {
		totalEvents,
		activeEvents,
		completedEvents,
		totalContracts,
		activeContracts,
		completedContracts,
		cancelledContracts,
		totalAmountSpent,
		totalRefunded,
		totalInEscrow,
		totalPendingRefunds,
		totalDisputesRaised,
		totalReviewsGiven,
	};
};

const getProfessionalAnalytics = async (user: RequestUser) => {
	const professional = await prisma.professional.findUnique({
		where: { userId: user.userId },
	});

	if (!professional) {
		throw new AppError(httpStatus.NOT_FOUND, "Professional Profile Not Found");
	}

	const totalServices = await prisma.professionalService.count({
		where: { professionalId: professional.id },
	});

	const activeServices = await prisma.professionalService.count({
		where: { professionalId: professional.id, isActive: true },
	});

	const totalProposals = await prisma.proposal.count({
		where: { professionalId: professional.id },
	});

	const acceptedProposalItems = await prisma.proposalItem.count({
		where: {
			proposal: { professionalId: professional.id },
			status: ProposalStatus.ACCEPTED,
		},
	});

	const totalContracts = await prisma.contract.count({
		where: { professionalId: professional.id },
	});

	const activeContracts = await prisma.contract.count({
		where: {
			professionalId: professional.id,
			status: { in: [ContractStatus.CONFIRMED, ContractStatus.IN_PROGRESS] },
		},
	});

	const completedContracts = await prisma.contract.count({
		where: {
			professionalId: professional.id,
			status: ContractStatus.COMPLETED,
		},
	});

	const cancelledContracts = await prisma.contract.count({
		where: {
			professionalId: professional.id,
			status: ContractStatus.CANCELLED,
		},
	});

	const totalEarningsResult = await prisma.payment.aggregate({
		where: {
			contract: { professionalId: professional.id },
			status: PaymentStatus.COMPLETED,
		},
		_sum: { amount: true },
	});

	const totalEarnings = totalEarningsResult._sum.amount?.toNumber() || 0;

	const totalRefundedResult = await prisma.payment.aggregate({
		where: {
			contract: { professionalId: professional.id },
			status: PaymentStatus.REFUNDED,
		},
		_sum: { amount: true },
	});

	const totalRefunded = totalRefundedResult._sum.amount?.toNumber() || 0;

	const totalPendingRefundsResult = await prisma.refund.aggregate({
		where: {
			contract: { professionalId: professional.id },
			status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
		},
		_sum: { amount: true },
	});

	const totalPendingRefunds =
		totalPendingRefundsResult._sum.amount?.toNumber() || 0;

	// money the platform holds for the professional until the contract is
	// completed
	const totalPendingPayoutResult = await prisma.payment.aggregate({
		where: {
			contract: { professionalId: professional.id },
			status: PaymentStatus.ESCROWED,
		},
		_sum: { amount: true },
	});

	const totalPendingPayout =
		totalPendingPayoutResult._sum.amount?.toNumber() || 0;

	const totalDisputesRaised = await prisma.dispute.count({
		where: { raisedById: user.userId },
	});

	return {
		totalServices,
		activeServices,
		totalProposals,
		acceptedProposalItems,
		totalContracts,
		activeContracts,
		completedContracts,
		cancelledContracts,
		totalEarnings,
		totalRefunded,
		totalPendingPayout,
		totalPendingRefunds,
		averageRating: professional.averageRating?.toNumber() || 0,
		totalReviews: professional.totalReviews,
		totalDisputesRaised,
	};
};

export const AnalyticsServices = {
	getAdminAnalytics,
	getClientAnalytics,
	getProfessionalAnalytics,
};
