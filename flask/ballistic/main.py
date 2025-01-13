import missile_and_target
import numpy as np

from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/create_scene', methods=['POST'])

def create_scene():
    data = request.get_json()
    target = missile_and_target.CreateTarget(
        t,
        x_lim=data['target']['x_lim'],
        y_max=data['target']['y_max'],
        time_factor=data['target']['time_factor']
    )
    missile = missile_and_target.Missile(
        position_x=data['missile']['position_x'],
        position_y=data['missile']['position_y'],
        velocity_x=data['missile']['velocity_x'],
        velocity_y=data['missile']['velocity_y'],
        acceleration=data['missile']['acceleration'],
        miss_limit=data['missile']['miss_limit'],
        start_time=data['missile']['start_time'],
        boost_time=data['missile']['boost_time'],
        boost_acceleration=data['missile']['boost_acceleration'],
        seeker_range=data['missile']['seeker_range']
    )
    engagement = missile_and_target.run_simulation(missile, target, data['engagement_type'])
    return jsonify(engagement)

t = np.arange(0, 100, 0.01)

# target_1 = missile_and_target.Target(t, position_x=0, position_y=0, velocity_x=250, velocity_y=500, ballistic=1)
# target_2 = missile_and_target.Target(t, position_x=0, position_y=5000, velocity_x=50, velocity_y=0, ballistic=0)
target_3 = missile_and_target.CreateTarget(t, x_lim=1000, y_max=1000, time_factor=100)

missile_1 = missile_and_target.Missile(
                    position_x=1000,
                    position_y=0,
                    velocity_x=0,
                    velocity_y=500,
                    acceleration=5000,
                    miss_limit=150,
                    start_time=10,
                    boost_time=0,
                    boost_acceleration=5000,
                    seeker_range=1000)

missile_2 = missile_and_target.Missile(
                    position_x=15000,
                    position_y=0,
                    velocity_x=-500,
                    velocity_y=500,
                    acceleration=1000,
                    miss_limit=150,
                    start_time=12,
                    boost_time=0,
                    boost_acceleration=5000,
                    seeker_range=1000)

missile_3 = missile_and_target.Missile(
                    position_x=-10000,
                    position_y=0,
                    velocity_x=0,
                    velocity_y=500,
                    acceleration=5000,
                    miss_limit=150,
                    start_time=15,
                    boost_time=0,
                    boost_acceleration=0,
                    seeker_range=1000)

missile_4 = missile_and_target.Missile(
                    position_x=15000,
                    position_y=0,
                    velocity_x=0,
                    velocity_y=750,
                    acceleration=5000,
                    miss_limit=150,
                    start_time=7,
                    boost_time=0,
                    boost_acceleration=0,
                    seeker_range=1000)


# engagement_1 = missile_and_target.run_simulation(missile_1, target_1, 'chase')
# engagement_2 = missile_and_target.run_simulation(missile_2, target_1, 'chase')

# engagement_3 = missile_and_target.run_simulation(missile_2, target_2, 'chase')
# engagement_4 = missile_and_target.run_simulation(missile_2, target_2, 'half-lead')
# engagement_5 = missile_and_target.run_simulation(missile_2, target_2, 'proportional')
# engagement_6 = missile_and_target.run_simulation(missile_2, target_2, 'optimal')

# engagement_7 = missile_and_target.run_simulation(missile_2, target_1, 'chase')
# engagement_8 = missile_and_target.run_simulation(missile_2, target_1, 'half-lead')
# engagement_9 = missile_and_target.run_simulation(missile_2, target_1, 'proportional')

# engagement_10 = missile_and_target.run_simulation(missile_3, target_1, 'chase')
# engagement_11 = missile_and_target.run_simulation(missile_3, target_1, 'half-lead')
# engagement_12 = missile_and_target.run_simulation(missile_3, target_1, 'optimal')
# engagement_13 = missile_and_target.run_simulation(missile_3, target_1, 'proportional')

# engagement_14 = missile_and_target.run_simulation(missile_4, target_1, 'chase')
# engagement_15 = missile_and_target.run_simulation(missile_4, target_1, 'half-lead')
# engagement_16 = missile_and_target.run_simulation(missile_4, target_1, 'proportional')
# engagement_17 = missile_and_target.run_simulation(missile_4, target_1, 'optimal')

engagement_20 = missile_and_target.run_simulation(missile_1, target_3, 'proportional')
missile_and_target.plot_trajectory(engagement_20)



# missile_and_target.plot_trajectory(engagement_1, engagement_2)
# missile_and_target.plot_trajectory(engagement_3, engagement_4, engagement_5, engagement_6)
# missile_and_target.plot_trajectory(engagement_7, engagement_8, engagement_9)
# missile_and_target.plot_trajectory(engagement_10, engagement_11, engagement_12, engagement_13)

# missile_and_target.plot_trajectory(engagement_1, engagement_2, engagement_7, engagement_8, engagement_9, engagement_10, engagement_11, engagement_12, engagement_13)
# missile_and_target.plot_trajectory(engagement_1, engagement_7, engagement_11, engagement_16)
if __name__ == '__main__':
    app.run(debug=True)