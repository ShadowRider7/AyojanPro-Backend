export interface IUpdateUserStatus {
	status: "ACTIVE" | "SUSPENDED" | "BLOCKED";
}

export interface IUpdateRefundStatus {
	status: "COMPLETED" | "FAILED";
	note?: string;
	reference?: string;
}
