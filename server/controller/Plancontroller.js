import Plan from "../model/Plan.js";



export const createplan = async (req, res) => {
  try {

    const {
      PlanName,
      Description,
      Price,
      Currency,
      BillingPeriod,
      BillingInterval,
      MaxUsers,
      AllowCustomDomain,
      IsActive
    } = req.body;

    // Required fields check (without Id)
    if (!PlanName || !BillingPeriod || !BillingInterval) {
      return res.status(400).send({
        message: "Missing required fields"
      });
    }

    // Create Plan (MongoDB auto-generates _id)
    const data = await Plan.create({
      PlanName,
      Description,
      Price,
      Currency,
      BillingPeriod,
      BillingInterval,
      MaxUsers,
      AllowCustomDomain,
      IsActive
    });

    return res.status(201).send({
      message: "Plan created successfully",
      planId: data._id,
      data
    });

  } catch (error) {
    console.error("fail to submit data:", error);
    return res.status(500).send({
      message: "Internal server error",
      error: error.message
    });
  }
};


export const getallplans = async (req, res) => {
    try {
        const data = await Plan.find();

        return res.status(200).send({
            message: "Plans fetched successfully",
            data
        });

    } catch (error) {
        console.error("fail to fetch plans:", error);
        return res.status(500).send({
            message: "Internal server error",
            error: error.message
        });
    }
};

export const getplanbyid = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).send({
                message: "Plan ID is required"
            });
        }

        // Convert id to number since the schema expects Id as Number
        const data = await Plan.findOne({ Id: Number(id) });

        if (!data) {
            return res.status(404).send({
                message: "Plan not found"
            });
        }

        return res.status(200).send({
            message: "Plan fetched successfully",
            data
        });

    } catch (error) {
        console.error("fail to fetch plan:", error);
        return res.status(500).send({
            message: "Internal server error",
            error: error.message
        });
    }
};

