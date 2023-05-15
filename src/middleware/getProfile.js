
const getProfile = async (req, res, next) => {
    const {Profile} = req.app.get('models')
    console.log(req.get('profile_id'));
    const profileId = req.get('profile_id') || 0; // Assuming 'profile_id' is the header key for the profile ID
    const profile = await Profile.findOne({where: {id: profileId}})
    if(!profile) return res.status(401).end()
    req.profile = profile
    next()
}
module.exports = {getProfile}