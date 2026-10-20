/**
 * The dataset behind `scripts/seed-demo-data.ts`.
 *
 * Everything here is fictional: the mailboxes are fake Gmail addresses that
 * nobody owns, so the platform can be demoed end to end without a real inbox.
 * The passwords are shared by role, which keeps the generated credentials
 * document short and easy to rotate.
 */

export const DEMO_ADMIN = {
	name: "AyojanPro Demo Admin",
	email: "demo.admin@gmail.com",
	password: "Demo@Admin12345",
};

export const DEMO_CLIENT_PASSWORD = "Demo@Client12345";
export const DEMO_PROFESSIONAL_PASSWORD = "Demo@Pro12345";

export type DemoSkill = {
	name: string;
	description: string;
};

export type DemoService = {
	name: string;
	description: string;
	pricingNote: string;
	minimumPrice: number;
	maximumPrice: number;
};

export type DemoExperience = {
	title: string;
	organization: string;
	description: string;
	startDate: string;
	endDate: string;
};

export type DemoProfessional = {
	name: string;
	email: string;
	phone: string;
	address: string;
	city: string;
	country: string;
	professionalTitle: string;
	bio: string;
	experienceYears: number;
	skills: DemoSkill[];
	services: DemoService[];
	experiences: DemoExperience[];
};

export type DemoClient = {
	name: string;
	email: string;
	phone: string;
	address: string;
	city: string;
	country: string;
	bio: string;
};

export type DemoRequirement = {
	serviceName: string;
	description: string;
	budget: number;
	currency: string;
	/** Inside the parent event window — the backend rejects anything outside. */
	startAt: string;
	endAt: string;
};

export type DemoEvent = {
	title: string;
	description: string;
	eventType: string;
	address: string;
	city: string;
	country: string;
	startAt: string;
	endAt: string;
	/** Email of the client account that owns the event. */
	clientEmail: string;
	requirements: DemoRequirement[];
};

export type DemoProposal = {
	/** Email of the professional account sending the proposal. */
	professionalEmail: string;
	/** Title of the event the professional bids on. */
	eventTitle: string;
	/** Requirement (service name) the proposal covers. */
	serviceName: string;
	proposedAmount: number;
	currency: string;
	proposedStartAt: string;
	proposedEndAt: string;
	message: string;
};

export const demoClients: DemoClient[] = [
	{
		name: "Rumana Haque",
		email: "rumana.haque.demo@gmail.com",
		phone: "+8801711000001",
		address: "House 42, Road 11, Banani",
		city: "Dhaka",
		country: "Bangladesh",
		bio: "Wedding and reception planner. I organise family events end to end — venue, decoration, catering and photography — for around 20 events a year.",
	},
	{
		name: "Tanvir Ahmed",
		email: "tanvir.ahmed.demo@gmail.com",
		phone: "+8801811000002",
		address: "Plot 7, CDA Avenue, Pahartali",
		city: "Chattogram",
		country: "Bangladesh",
		bio: "Corporate event coordinator at a local tech brand. I handle product launches, annual conferences and dealer meets, and I need reliable vendors for every event.",
	},
	{
		name: "Nusrat Jahan",
		email: "nusrat.jahan.demo@gmail.com",
		phone: "+8801911000003",
		address: "House 9, Zindabazar",
		city: "Sylhet",
		country: "Bangladesh",
		bio: "Private event planner for birthdays, anniversaries and family gatherings. Small guest lists, high attention to detail, everything arranged well ahead of time.",
	},
];

export const demoProfessionals: DemoProfessional[] = [
	{
		name: "Arif Hossain",
		email: "arif.hossain.demo@gmail.com",
		phone: "+8801611000001",
		address: "House 18, Road 5, Mirpur DOHS",
		city: "Dhaka",
		country: "Bangladesh",
		professionalTitle: "Professional Wedding Videographer & Photographer",
		bio: "Wedding videographer and photographer with 8 years of experience covering Bangladeshi weddings. I shoot multi-cam, deliver a highlight film within 14 days and hand over a printed album with 100 retouched photos.",
		experienceYears: 8,
		skills: [
			{
				name: "Wedding Cinematography",
				description:
					"Multi-camera coverage of the wedding day, from the groom's baraat to the reception.",
			},
			{
				name: "Drone Photography",
				description:
					"Aerial venue and procession shots with a licensed drone operator.",
			},
			{
				name: "Photo Retouching",
				description:
					"Colour grading and skin retouching for a consistent album look.",
			},
			{
				name: "Documentary Editing",
				description:
					"Paceful highlight editing set to the couple's soundtrack.",
			},
		],
		services: [
			{
				name: "Professional Wedding Videoman",
				description:
					"Full day wedding coverage with 2 cameras, a highlight film and a raw footage archive.",
				pricingNote:
					"Price depends on the number of guests and the shooting hours. Travel inside Dhaka city is included.",
				minimumPrice: 18000,
				maximumPrice: 65000,
			},
			{
				name: "Wedding Photography & Album Design",
				description:
					"Candid and posed wedding photography with a 30x30 printed album.",
				pricingNote:
					"Album page count and number of photographers are quoted after the date is confirmed.",
				minimumPrice: 12000,
				maximumPrice: 45000,
			},
		],
		experiences: [
			{
				title: "Lead Wedding Videographer",
				organization: "Studio Roshni, Dhaka",
				description:
					"Shot more than 120 weddings across Dhaka and Chattogram, and built the studio's highlight film delivery workflow.",
				startDate: "2019-02-01",
				endDate: "2024-06-30",
			},
			{
				title: "Freelance Wedding Cinematographer",
				organization: "Independent",
				description:
					"Currently booking weddings and receptions directly with clients across the country.",
				startDate: "2024-07-01",
				endDate: "2026-10-01",
			},
		],
	},
	{
		name: "Sadia Islam",
		email: "sadia.islam.demo@gmail.com",
		phone: "+8801621000002",
		address: "House 5, Road 22, Banani",
		city: "Dhaka",
		country: "Bangladesh",
		professionalTitle: "Professional Event Decorator",
		bio: "Event decorator specialising in wedding stages, reception backdrops and corporate branding. I work with a team of 8 and can set up a full venue in 6 hours.",
		experienceYears: 6,
		skills: [
			{
				name: "Stage & Backdrop Design",
				description:
					"Stage structures, draping and backdrop design for weddings and conferences.",
			},
			{
				name: "Floral Arrangement",
				description:
					"Fresh and artificial floral work for stages, tables and entrance gates.",
			},
			{
				name: "Lighting Design",
				description:
					"Ambient, spot and wash lighting plans for indoor and outdoor venues.",
			},
			{
				name: "Event Branding",
				description:
					"Corporate stage branding, banners and photo walls for launches and conferences.",
			},
		],
		services: [
			{
				name: "Professional Event Decorator",
				description:
					"Full venue decoration for weddings, receptions and corporate events including entrance, stage and table setup.",
				pricingNote:
					"Quotation depends on the venue size and the number of decoration points.",
				minimumPrice: 20000,
				maximumPrice: 150000,
			},
			{
				name: "Stage & Backdrop Decoration",
				description:
					"Stage setup with draping, florals, lighting and a photo wall.",
				pricingNote: "Stage size and material choice change the final price.",
				minimumPrice: 12000,
				maximumPrice: 90000,
			},
		],
		experiences: [
			{
				title: "Lead Decorator",
				organization: "Decor Horizon, Dhaka",
				description:
					"Delivered decoration for 200+ weddings and receptions and managed a team of 6 decorators.",
				startDate: "2020-01-15",
				endDate: "2023-12-31",
			},
			{
				title: "Founder — Event Decor Studio",
				organization: "Event Decor Studio, Dhaka",
				description:
					"Running my own decoration studio with a team of 8 and a rental inventory of stages and lights.",
				startDate: "2024-01-01",
				endDate: "2026-10-01",
			},
		],
	},
	{
		name: "Karim Uddin",
		email: "karim.uddin.demo@gmail.com",
		phone: "+8801631000003",
		address: "House 12, Patharghatta",
		city: "Chattogram",
		country: "Bangladesh",
		professionalTitle: "Professional Catering Service Provider",
		bio: "Catering service provider in Chattogram running a kitchen and a fleet of delivery vans. I cater for weddings, conferences and corporate dinners for 50 to 800 guests.",
		experienceYears: 11,
		skills: [
			{
				name: "Bengali & Chinese Cuisine",
				description:
					"Buffet menus covering traditional Bengali dishes and Chinese counters.",
			},
			{
				name: "Live BBQ Counter",
				description:
					"On-site grill counters with fresh marinated meat and a trained chef.",
			},
			{
				name: "Food Safety & Hygiene",
				description:
					"HACCP-style kitchen routine, safe water and chilled transport.",
			},
			{
				name: "Large Scale Catering",
				description:
					"Service teams and logistics for events with several hundred guests.",
			},
		],
		services: [
			{
				name: "Professional Catering Service Provider",
				description:
					"Full-service catering with buffet or table service, serving staff and on-site setup.",
				pricingNote:
					"Price per head depends on the menu tier. Minimum 50 guests, advance booking of 7 days.",
				minimumPrice: 450,
				maximumPrice: 1250,
			},
			{
				name: "Live BBQ Counter Service",
				description:
					"Live grill counter with 4 barbecue chefs and a fixed menu of 6 items.",
				pricingNote:
					"Per counter, up to 120 guests. Includes chef, fuel and serving staff.",
				minimumPrice: 8000,
				maximumPrice: 25000,
			},
		],
		experiences: [
			{
				title: "Head of Catering",
				organization: "Chattogram Grand Banquet",
				description:
					"Managed the banquet kitchen and a team of 25, serving 400+ guests per event.",
				startDate: "2016-03-01",
				endDate: "2022-11-30",
			},
			{
				title: "Owner — Karim Catering Service",
				organization: "Karim Catering Service, Chattogram",
				description:
					"Running my own catering business for weddings, conferences and corporate dinners.",
				startDate: "2022-12-01",
				endDate: "2026-10-01",
			},
		],
	},
	{
		name: "Noor Rahman",
		email: "noor.rahman.demo@gmail.com",
		phone: "+8801641000004",
		address: "House 4, Shahbagh, Ambarkhana",
		city: "Sylhet",
		country: "Bangladesh",
		professionalTitle: "Professional Makeup Artist",
		bio: "Makeup artist working in Sylhet for the last 5 years — bridal, party and editorial looks. I am known for long-lasting HD makeup that survives a full wedding day.",
		experienceYears: 5,
		skills: [
			{
				name: "Bridal Makeup",
				description:
					"Traditional and contemporary bridal looks with a trial session.",
			},
			{
				name: "HD & Airbrush Makeup",
				description: "Cake-style HD finish for photography and camera work.",
			},
			{
				name: "Hair Styling",
				description:
					"Bridal buns, waves and updos that last through the event.",
			},
			{
				name: "Men's Grooming",
				description:
					"Groom makeup, hair styling and skin prep for the wedding day.",
			},
		],
		services: [
			{
				name: "Professional Makeup Artist",
				description:
					"Makeup for the bride, family and friends on the day of the event.",
				pricingNote:
					"Quoted per person. Early booking and a trial session are included in the bridal package.",
				minimumPrice: 3000,
				maximumPrice: 12000,
			},
			{
				name: "Bridal Makeup & Hair Styling Package",
				description:
					"Complete bridal package: trial session, day-of makeup and hair, plus a touch-up kit.",
				pricingNote:
					"Trial session and kit are included. Travel outside the city is charged separately.",
				minimumPrice: 8000,
				maximumPrice: 25000,
			},
		],
		experiences: [
			{
				title: "Bridal Makeup Artist",
				organization: "Mehendi Studio, Sylhet",
				description:
					"Created bridal looks for 150+ weddings and engagements across Sylhet and Moulvibazar.",
				startDate: "2021-04-01",
				endDate: "2024-02-29",
			},
			{
				title: "Independent Makeup Artist",
				organization: "Independent",
				description:
					"Booking bridal and event makeup directly with clients, with a team of two assistants.",
				startDate: "2024-03-01",
				endDate: "2026-10-01",
			},
		],
	},
	{
		name: "Rafiul Islam",
		email: "rafiul.islam.demo@gmail.com",
		phone: "+8801651000005",
		address: "House 27, Kazi Nazrul Road",
		city: "Dhaka",
		country: "Bangladesh",
		professionalTitle: "Professional Sound & Lighting Engineer",
		bio: "Sound and lighting engineer with 9 years in live events. I provide the full audio visual setup — mixing desk, wireless microphones, line array speakers and stage lighting.",
		experienceYears: 9,
		skills: [
			{
				name: "Live Sound Engineering",
				description:
					"FOH mixing for concerts, conferences and wedding programmes.",
			},
			{
				name: "Stage Lighting Design",
				description:
					"Moving heads, wash and blinders programmed for each performance.",
			},
			{
				name: "Wireless Microphone & PA Systems",
				description:
					"UHF handheld and lapel microphones with automatic frequency coordination.",
			},
			{
				name: "DJ & Live Band Support",
				description:
					"Rigging and monitoring for DJs, live bands and cultural programmes.",
			},
		],
		services: [
			{
				name: "Professional Sound & Lighting Engineer",
				description:
					"Full sound and lighting package with an engineer on site for the whole event.",
				pricingNote:
					"Quotation depends on the venue size, the number of speakers and the lighting rig.",
				minimumPrice: 15000,
				maximumPrice: 120000,
			},
			{
				name: "DJ & Live Band Setup",
				description:
					"DJ booth, monitor wedges, backline and lighting for a live performance.",
				pricingNote:
					"Includes setup, cabling and a sound check before the programme starts.",
				minimumPrice: 10000,
				maximumPrice: 60000,
			},
		],
		experiences: [
			{
				title: "Sound Engineer",
				organization: "Dhaka Sound & Light, Dhaka",
				description:
					"Ran the FOH desk for 300+ concerts and corporate conferences, including the national music festival.",
				startDate: "2017-05-01",
				endDate: "2023-08-31",
			},
			{
				title: "Founder — Rafiul Sound & Light",
				organization: "Rafiul Sound & Light, Dhaka",
				description:
					"Booking audio visual packages for weddings, concerts and conference stages across the country.",
				startDate: "2023-09-01",
				endDate: "2026-10-01",
			},
		],
	},
];

export const demoEvents: DemoEvent[] = [
	{
		title: "Rahat & Sadia's Wedding Reception",
		description:
			"Afternoon reception for 350 guests at a rooftop venue in Banani. We need the hall decorated, a video record of the speeches and the entrance, and full dinner service.",
		eventType: "WEDDING_RECEPTION",
		address: "Grand Palm Hall, Road 11, Banani",
		city: "Dhaka",
		country: "Bangladesh",
		startAt: "2026-12-19T04:00:00.000Z",
		endAt: "2026-12-19T16:00:00.000Z",
		clientEmail: "rumana.haque.demo@gmail.com",
		requirements: [
			{
				serviceName: "Professional Wedding Videoman",
				description:
					"Cover the entrance, the couple's entry and the cutting ceremony. A highlight film is enough.",
				budget: 25000,
				currency: "BDT",
				startAt: "2026-12-19T05:00:00.000Z",
				endAt: "2026-12-19T15:00:00.000Z",
			},
			{
				serviceName: "Professional Event Decorator",
				description:
					"Stage, entrance gate and table decoration in a pastel theme with a photo wall.",
				budget: 45000,
				currency: "BDT",
				startAt: "2026-12-19T06:00:00.000Z",
				endAt: "2026-12-19T14:00:00.000Z",
			},
			{
				serviceName: "Professional Catering Service Provider",
				description: "Dinner buffet for 350 guests with one live BBQ counter.",
				budget: 120000,
				currency: "BDT",
				startAt: "2026-12-19T09:00:00.000Z",
				endAt: "2026-12-19T15:00:00.000Z",
			},
		],
	},
	{
		title: "Nova Tech Annual Product Launch",
		description:
			"Launch event for 200 guests at a Chattogram hotel. Product reveal stage, band and dinner for the dealers and press.",
		eventType: "CORPORATE",
		address: "Blue Horizon Hall, CDA Avenue, Chattogram",
		city: "Chattogram",
		country: "Bangladesh",
		startAt: "2026-11-21T05:00:00.000Z",
		endAt: "2026-11-21T13:00:00.000Z",
		clientEmail: "tanvir.ahmed.demo@gmail.com",
		requirements: [
			{
				serviceName: "Professional Event Decorator",
				description:
					"Branded stage backdrop with the product display and a registration desk.",
				budget: 60000,
				currency: "BDT",
				startAt: "2026-11-21T06:00:00.000Z",
				endAt: "2026-11-21T11:00:00.000Z",
			},
			{
				serviceName: "Professional Catering Service Provider",
				description: "Buffet dinner for 200 guests with 4 vegetarian options.",
				budget: 90000,
				currency: "BDT",
				startAt: "2026-11-21T09:00:00.000Z",
				endAt: "2026-11-21T12:00:00.000Z",
			},
			{
				serviceName: "Professional Sound & Lighting Engineer",
				description:
					"Speech reinforcement, band playback and stage lighting for the product reveal.",
				budget: 35000,
				currency: "BDT",
				startAt: "2026-11-21T06:00:00.000Z",
				endAt: "2026-11-21T12:00:00.000Z",
			},
		],
	},
	{
		title: "Ayesha's 25th Birthday Celebration",
		description:
			"Private birthday dinner for 90 guests in a garden restaurant in Sylhet, with photos and makeup for the family.",
		eventType: "BIRTHDAY",
		address: "Nirvana Garden, Zindabazar",
		city: "Sylhet",
		country: "Bangladesh",
		startAt: "2026-11-07T08:00:00.000Z",
		endAt: "2026-11-07T16:00:00.000Z",
		clientEmail: "nusrat.jahan.demo@gmail.com",
		requirements: [
			{
				serviceName: "Professional Makeup Artist",
				description: "Makeup for the birthday girl and four family members.",
				budget: 18000,
				currency: "BDT",
				startAt: "2026-11-07T11:00:00.000Z",
				endAt: "2026-11-07T14:00:00.000Z",
			},
			{
				serviceName: "Professional Wedding Videoman",
				description: "Candid video of the evening, roughly four hours.",
				budget: 15000,
				currency: "BDT",
				startAt: "2026-11-07T10:00:00.000Z",
				endAt: "2026-11-07T15:00:00.000Z",
			},
		],
	},
	{
		title: "Rahim & Tasmia Engagement Ceremony",
		description:
			"Engagement ceremony for 180 guests. Simple stage, floral entrance and a photo album for the family.",
		eventType: "WEDDING",
		address: "Rose Garden, Mirpur",
		city: "Dhaka",
		country: "Bangladesh",
		startAt: "2026-12-05T07:00:00.000Z",
		endAt: "2026-12-05T15:00:00.000Z",
		clientEmail: "rumana.haque.demo@gmail.com",
		requirements: [
			{
				serviceName: "Professional Event Decorator",
				description: "Engagement stage, floral entrance and a photo corner.",
				budget: 30000,
				currency: "BDT",
				startAt: "2026-12-05T08:00:00.000Z",
				endAt: "2026-12-05T13:00:00.000Z",
			},
			{
				serviceName: "Wedding Photography & Album Design",
				description: "Engagement photography with a 20 page album.",
				budget: 22000,
				currency: "BDT",
				startAt: "2026-12-05T08:00:00.000Z",
				endAt: "2026-12-05T14:00:00.000Z",
			},
		],
	},
	{
		title: "Golden Jubilee Anniversary Dinner",
		description:
			"Family dinner for 120 guests celebrating 50 years, with a live band and a full dinner service.",
		eventType: "ANNIVERSARY",
		address: "Hotel Rajmahi, Shahbagh",
		city: "Sylhet",
		country: "Bangladesh",
		startAt: "2026-10-30T09:00:00.000Z",
		endAt: "2026-10-30T18:00:00.000Z",
		clientEmail: "nusrat.jahan.demo@gmail.com",
		requirements: [
			{
				serviceName: "Professional Catering Service Provider",
				description:
					"Dinner service for 120 guests with a traditional Bengali menu.",
				budget: 75000,
				currency: "BDT",
				startAt: "2026-10-30T12:00:00.000Z",
				endAt: "2026-10-30T17:00:00.000Z",
			},
			{
				serviceName: "Professional Sound & Lighting Engineer",
				description:
					"Sound for speeches and the live band, with warm lighting for the hall.",
				budget: 25000,
				currency: "BDT",
				startAt: "2026-10-30T11:00:00.000Z",
				endAt: "2026-10-30T17:00:00.000Z",
			},
		],
	},
];

export const demoProposals: DemoProposal[] = [
	{
		professionalEmail: "arif.hossain.demo@gmail.com",
		eventTitle: "Rahat & Sadia's Wedding Reception",
		serviceName: "Professional Wedding Videoman",
		proposedAmount: 24000,
		currency: "BDT",
		proposedStartAt: "2026-12-19T05:00:00.000Z",
		proposedEndAt: "2026-12-19T14:00:00.000Z",
		message:
			"I can cover the entrance, the couple's entry and the cutting ceremony with two cameras and deliver the highlight film within 14 days. Portfolio of similar rooftop receptions available on request.",
	},
	{
		professionalEmail: "arif.hossain.demo@gmail.com",
		eventTitle: "Rahim & Tasmia Engagement Ceremony",
		serviceName: "Wedding Photography & Album Design",
		proposedAmount: 21000,
		currency: "BDT",
		proposedStartAt: "2026-12-05T08:00:00.000Z",
		proposedEndAt: "2026-12-05T13:00:00.000Z",
		message:
			"Candid and posed coverage of the engagement ceremony with 100 retouched photos and a 20 page album delivered in three weeks.",
	},
	{
		professionalEmail: "sadia.islam.demo@gmail.com",
		eventTitle: "Rahat & Sadia's Wedding Reception",
		serviceName: "Professional Event Decorator",
		proposedAmount: 42000,
		currency: "BDT",
		proposedStartAt: "2026-12-19T06:00:00.000Z",
		proposedEndAt: "2026-12-19T13:00:00.000Z",
		message:
			"Pastel stage, entrance gate, table styling and a photo wall. My team of eight can set up the venue in six hours before the guests arrive.",
	},
	{
		professionalEmail: "karim.uddin.demo@gmail.com",
		eventTitle: "Nova Tech Annual Product Launch",
		serviceName: "Professional Catering Service Provider",
		proposedAmount: 88000,
		currency: "BDT",
		proposedStartAt: "2026-11-21T09:00:00.000Z",
		proposedEndAt: "2026-11-21T12:00:00.000Z",
		message:
			"Buffet for 200 guests with a live BBQ counter, serving staff and chilled transport. Menu options are shared in the proposal document.",
	},
	{
		professionalEmail: "noor.rahman.demo@gmail.com",
		eventTitle: "Ayesha's 25th Birthday Celebration",
		serviceName: "Professional Makeup Artist",
		proposedAmount: 17000,
		currency: "BDT",
		proposedStartAt: "2026-11-07T11:00:00.000Z",
		proposedEndAt: "2026-11-07T14:00:00.000Z",
		message:
			"HD makeup for the birthday girl and four family members, with a touch-up kit and hair styling for the evening photos.",
	},
	{
		professionalEmail: "rafiul.islam.demo@gmail.com",
		eventTitle: "Nova Tech Annual Product Launch",
		serviceName: "Professional Sound & Lighting Engineer",
		proposedAmount: 33000,
		currency: "BDT",
		proposedStartAt: "2026-11-21T06:00:00.000Z",
		proposedEndAt: "2026-11-21T12:00:00.000Z",
		message:
			"FOH mixing for the speeches and the product reveal, wireless microphones for the presenters and a lighting rig for the stage. A sound check is included before the programme.",
	},
];
