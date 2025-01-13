import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import math
from scipy.optimize import minimize
import create_target_trajectory


def remove_values_below_zero(ref_arr, change_arr):
    result = []
    zero_found = False

    refInd = 0
    for num in ref_arr:
        if num >= 0:
            result.append(change_arr[refInd])
        elif not zero_found:
            result.append(change_arr[refInd])
            zero_found = True
        refInd += 1

    return result


def calculateAirDensity(altitudeFeet):
    altitudeMeters = altitudeFeet * 0.3048
    # Constants for the model
    seaLevelPressure = 101325  # Pa
    seaLevelTemperature = 288.15  # K
    lapseRate = 0.0065  # K/m
    gasConstantAir = 287.05  # J/(kg*K)
    seaLevelDensity = 1.225  # kg/m^3

    if altitudeMeters < 0:
        density = seaLevelDensity

    # Limit altitude to the troposphere limit (11,000 meters) for this simple model
    if altitudeMeters > 11000:
        altitudeMeters = 11000

    temperature = seaLevelTemperature - lapseRate * altitudeMeters

    pressure = seaLevelPressure * (temperature / seaLevelTemperature) ** (9.80665 / (gasConstantAir * lapseRate))

    density = pressure / (gasConstantAir * temperature)

    return density / 0.062428


def calculateGravity(altitude):
    G = 6.67430e-11  # Gravitational constant in m^3 kg^-1 s^-2
    earthMass = 5.972e24  # Mass of Earth in kg
    earthRadius = 6.371e6  # Radius of Earth in meters

    distance = earthRadius + altitude

    gravity = (G * earthMass) / (distance ** 2)

    return -gravity


class Missile:
    def __init__(self, position_x, position_y, velocity_x, velocity_y, acceleration, miss_limit, start_time, boost_time,
                 boost_acceleration, seeker_range):
        self.position_x = position_x
        self.position_y = position_y
        self.velocity_x = velocity_x
        self.velocity_y = velocity_y

        self.acceleration = acceleration
        self.miss_limit = miss_limit
        self.start_time = start_time
        self.boost_time = boost_time
        self.boost_acceleration = boost_acceleration
        self.seeker_range = seeker_range


class Target:
    def __init__(self, time_vec, position_x, position_y, velocity_x, velocity_y, ballistic):
        self.ax = 0
        self.ay = -32.2 * ballistic
        self.position_x = position_x + (velocity_x * time_vec) + (0.5 * self.ax * time_vec ** 2)
        self.position_y = position_y + (velocity_y * time_vec) + (0.5 * self.ay * time_vec ** 2)
        self.velocity_x = velocity_x + self.ax * time_vec
        self.velocity_y = velocity_y + self.ay * time_vec
        self.m = 1
        self.time = time_vec
        self.ballistic = ballistic

        self.position_x = remove_values_below_zero(self.position_y, self.position_x)
        self.position_y = remove_values_below_zero(self.position_y, self.position_y)
        self.time = remove_values_below_zero(self.position_y, self.time)


class CreateTarget:
    def __init__(self, time_vec, x_lim, y_max, time_factor):
        path_x, path_y = create_target_trajectory.draw_on_plot(x_lim, y_max)
        smoothed_x, smoothed_y = create_target_trajectory.smooth_path(path_x, path_y, smooth_factor=0.5)

        # i love nateys
        self.position_x = smoothed_x
        self.position_y = smoothed_y

        # self.time = time_vec[1:len(self.position_x)]
        time_max = time_vec[len(smoothed_x) - 1] * time_factor
        self.time = np.linspace(0, time_max, len(smoothed_x))

        self.velocity_x = np.diff(self.position_x) / np.diff(self.time)
        self.velocity_y = np.diff(self.position_y) / np.diff(self.time)
        self.ax = np.diff(self.velocity_x) / np.diff(self.time[0:len(self.velocity_x)])
        self.ay = np.diff(self.velocity_y) / np.diff(self.time[0:len(self.velocity_y)])

        self.m = 1
        self.ballistic = 0

        # print("Length of time vector: ", len(self.time))
        # print("Length of position x vector: ", len(self.position_x))
        # print("Length of position y vector: ", len(self.position_y))
        # print("Length of velocity x vector: ", len(self.velocity_x))
        # print("Length of velocity y vector: ", len(self.velocity_y))
        # print("Length of acceleration x vector: ", len(self.ax))
        # print("Length of acceleration y vector: ", len(self.ay))
        # self.position_x = remove_values_below_zero(self.position_y, self.position_x)
        # self.position_y = remove_values_below_zero(self.position_y, self.position_y)
        # self.time = remove_values_below_zero(self.position_y, self.time)


class Engagement:
    def __init__(self, time, position_x, position_y, velocity_x, velocity_y, recorded_target_x, recorded_target_y,
                 missile_start_time, end_time, miss_distance, success):
        self.time = time
        self.position_x = position_x
        self.position_y = position_y
        self.velocity_x = velocity_x
        self.velocity_y = velocity_y
        self.recorded_target_x = recorded_target_x
        self.recorded_target_y = recorded_target_y
        self.start_time = missile_start_time
        self.end_time = end_time
        self.miss_distance = miss_distance
        self.success = success


def run_simulation(missile, target, guidance):
    print("Running simulation with guidance: ", guidance)
    dt = target.time[1] - target.time[0]
    timeInd = 1
    previousDist = 9999
    targ_time_ind = 0
    return_time = target.time

    recorded_target_x = []
    recorded_target_y = []
    missile_x = [missile.position_x]
    missile_y = [missile.position_y]
    missile_vx = [missile.velocity_x]
    missile_vy = [missile.velocity_y]
    break_flag = False
    theta = -np.pi
    NC = 3
    APN_bias = 0.0

    if guidance == 'optimal':
        theta = find_optimal_angle(missile.position_x, missile.position_y, missile.velocity_x, missile.velocity_y, target.position_x[0], target.position_y[0], target.velocity_x[0], target.velocity_y[0], missile.acceleration, -32.2 * target.ballistic, target.time, missile.start_time)

    print("Max time: ", max(target.time))
    print("Length of target time: ", len(target.time))

    for curr_time in target.time:
        if break_flag:
            break
        target_index = np.where(target.time == curr_time)[0]

        recorded_target_x.append(target.position_x[target_index[0]])
        recorded_target_y.append(target.position_y[target_index[0]])
        # ay = calculateGravity(missile_y[timeInd - 1])
        ay = -32.2 * target.ballistic

        if curr_time >= missile.start_time:
            dx = target.position_x[target_index[0]] - missile_x[timeInd - 1]
            dy = target.position_y[target_index[0]] - missile_y[timeInd - 1]

            if guidance == 'half-lead':
                if target.ballistic == 0:
                    dvx = target.velocity_x[target_index[0]] - missile_vx[timeInd - 1]
                    dvy = target.velocity_y[target_index[0]] - missile_vy[timeInd - 1]

                    distance = math.sqrt(dx ** 2 + dy ** 2)
                    closing_speed = math.sqrt(dvx ** 2 + dvy ** 2)

                    if closing_speed > 0:
                        lead_time = 0.5 * (distance / closing_speed)
                    else:
                        lead_time = 0

                    future_x = target.position_x[target_index[0]] + target.velocity_x[target_index[0]] * lead_time
                    future_y = target.position_y[target_index[0]] + target.velocity_y[target_index[0]] * lead_time

                    angle_to_target = math.atan2(future_y - missile_y[timeInd - 1], future_x - missile_x[timeInd - 1])

                    desired_vx = math.cos(angle_to_target) * missile.acceleration * dt
                    desired_vy = math.sin(angle_to_target) * missile.acceleration * dt

                    missile_vx.append(missile_vx[timeInd - 1] + desired_vx)
                    missile_vy.append(missile_vy[timeInd - 1] + desired_vy)

                    missile_x.append(missile_x[timeInd - 1] + missile_vx[timeInd - 1] * dt)
                    missile_y.append(missile_y[timeInd - 1] + missile_vy[timeInd - 1] * dt)
                else:
                    dvx = target.velocity_x[target_index[0]] - missile_vx[timeInd - 1]
                    dvy = target.velocity_y[target_index[0]] - missile_vy[timeInd - 1]

                    distance = math.sqrt(dx ** 2 + dy ** 2)
                    closing_speed = math.sqrt(dvx ** 2 + dvy ** 2)

                    if closing_speed > 0:
                        lead_time = 0.5 * (distance / closing_speed)
                    else:
                        lead_time = 0

                    future_x = target.position_x[target_index[0]] + target.velocity_x[target_index[0]] * lead_time
                    future_y = target.position_y[target_index[0]] + target.velocity_y[target_index[0]] * lead_time + 0.5 * ay * lead_time ** 2

                    angle_to_target = math.atan2(future_y - missile_y[timeInd - 1], future_x - missile_x[timeInd - 1])

                    desired_vx = math.cos(angle_to_target) * missile.acceleration * dt
                    desired_vy = math.sin(angle_to_target) * missile.acceleration * dt

                    missile_vx.append(missile_vx[timeInd - 1] + desired_vx)
                    missile_vy.append(missile_vy[timeInd - 1] + desired_vy)

                    missile_x.append(missile_x[timeInd - 1] + missile_vx[timeInd - 1] * dt)
                    missile_y.append(missile_y[timeInd - 1] + missile_vy[timeInd - 1] * dt)

            elif guidance == 'proportional':
                ax_m, ay_m = pronav(missile_x[timeInd - 1], missile_y[timeInd - 1], target.position_x[target_index[0]], target.position_y[target_index[0]], missile.acceleration)

                missile_vx.append(missile_vx[timeInd - 1] + (ax_m * dt))
                missile_vy.append(missile_vy[timeInd - 1] + (ay * dt) + (ay_m * dt))

                missile_x.append(missile_x[timeInd - 1] + missile_vx[timeInd - 1] * dt)
                missile_y.append(missile_y[timeInd - 1] + missile_vy[timeInd - 1] * dt)

            else:
                if guidance == 'optimal':
                    theta = theta
                else:
                    theta = math.atan2(dy, dx)

                if curr_time < missile.boost_time + missile.start_time:  # Boost phase
                    missile_vx.append(missile_vx[timeInd - 1] + (
                            np.cos(theta) * missile.boost_acceleration * dt))
                    missile_vy.append(missile_vy[timeInd - 1] + (ay * dt) + (
                            np.sin(theta) * missile.boost_acceleration * dt))
                else:
                    missile_vx.append(missile_vx[timeInd - 1] + (
                            np.cos(theta) * missile.acceleration * dt))
                    missile_vy.append(missile_vy[timeInd - 1] + (ay * dt) + (
                            np.sin(theta) * missile.acceleration * dt))

                missile_x.append(missile_x[timeInd - 1] + missile_vx[timeInd - 1] * dt)
                missile_y.append(missile_y[timeInd - 1] + missile_vy[timeInd - 1] * dt)

            dist = np.sqrt((missile_x[timeInd] - target.position_x[target_index[0]]) ** 2 + (
                    missile_y[timeInd] - target.position_y[target_index[0]]) ** 2)

            if missile_y[timeInd] < 0 or dist < missile.miss_limit or curr_time == max(return_time) or ((dist > previousDist) and dist < missile.seeker_range):
                missile_x = missile_x[:timeInd + 1]
                missile_y = missile_y[:timeInd + 1]
                return_time = return_time[:targ_time_ind + 1]
                success = False
                if missile_y[timeInd] < 0:
                    print("Missile hit the ground at time {:.2f}s".format(curr_time))
                    print("Missile distance from target: {:.2f}".format(dist))
                elif dist < missile.miss_limit:
                    print("Missile hit the target at time {:.2f}s".format(curr_time))
                    print("Missile distance from target: {:.2f}".format(dist))
                    success = True
                elif timeInd == len(return_time) - 1:
                    print("Missile ran out of time at time {:.2f}s".format(curr_time))
                    print("Missile distance from target: {:.2f}".format(dist))
                else:
                    print("Missile passed target at time {:.2f}s".format(curr_time))
                    print(f"Missile distance from target {previousDist}")

                print("")
                return Engagement(return_time, missile_x, missile_y, missile_vx, missile_vx, recorded_target_x,
                                  recorded_target_y, missile.start_time, curr_time, min(dist, previousDist), success)

            timeInd += 1
            previousDist = dist

        targ_time_ind += 1


def plot_trajectory(*args):
    plt.figure()
    plt.ion()
    missileInd = [0] * len(args)
    numFrames = 5
    start_time = 0
    # start_time = min([arg.start_time for arg in args])

    minTime, maxTime, dt = find_time_range(*args)
    maxX, minX, maxY, minY = find_position_range(*args)
    t = np.arange(minTime, maxTime, dt)

    for i in range(len(t) - 1):
        if t[i] > start_time:
            if i % numFrames == 0:
                plt.clf()
                arg_ind = 0
                for arg in args:
                    if t[i] <= max(arg.time):
                        plt.plot(arg.recorded_target_x[0:i + 1], arg.recorded_target_y[0:i + 1], 'r-', label=f"Frame {i}")
                        plt.plot(arg.recorded_target_x[i], arg.recorded_target_y[i], 'ro', label=f"Frame {i}")

                        if t[i] >= arg.start_time:
                            plt.plot(arg.position_x[0:missileInd[arg_ind] + 1], arg.position_y[0:missileInd[arg_ind] + 1], 'b-',
                                     label=f"Frame {i}")
                            plt.plot(arg.position_x[missileInd[arg_ind]], arg.position_y[missileInd[arg_ind]], 'bd',
                                     label=f"Frame {i}")
                            missileInd[arg_ind] += 1*numFrames
                    else:
                        plt.plot(arg.recorded_target_x[0:len(arg.recorded_target_x)],
                                 arg.recorded_target_y[0:len(arg.recorded_target_x)], 'r-', label=f"Frame {i}")
                        plt.plot(arg.recorded_target_x[len(arg.recorded_target_x) - 1],
                                 arg.recorded_target_y[len(arg.recorded_target_y) - 1], 'ro', label=f"Frame {i}")

                        plt.plot(arg.position_x[0:len(arg.position_x)], arg.position_y[0:len(arg.position_y)], 'b-',
                                 label=f"Frame {i}")
                        plt.plot(arg.position_x[len(arg.position_x) - 1], arg.position_y[len(arg.position_y) - 1], 'bd',
                                 label=f"Frame {i}")

                        midpoint = (
                        (arg.position_x[len(arg.position_x) - 1] + arg.recorded_target_x[len(arg.recorded_target_x) - 1]) / 2,
                        (arg.position_y[len(arg.position_y) - 1] + arg.recorded_target_y[len(arg.recorded_target_y) - 1]) / 2)
                        distance = np.sqrt((arg.recorded_target_x[len(arg.recorded_target_x) - 1] - arg.position_x[
                            len(arg.position_x) - 1]) ** 2 + (
                                                       arg.recorded_target_y[len(arg.recorded_target_y) - 1] - arg.position_y[
                                                   len(arg.position_y) - 1]) ** 2)
                        radius = distance / 2
                        # Add a circle around the midpoint that encompasses both points
                        circle = patches.Circle(midpoint, radius, edgecolor='g', facecolor='none', linestyle='--')
                        plt.gca().add_patch(circle)  # Add circle to the current plot

                    arg_ind += 1
                plt.ylim(minY, maxY)
                plt.xlim(minX, maxX)

                plt.xlabel("X")
                plt.ylabel("Y")
                plt.title("Time = {:.2f}s".format(t[i]))
                plt.pause(0.01)

    plt.clf()
    for arg in args:
        plt.plot(arg.recorded_target_x[0:len(arg.recorded_target_x)],
                 arg.recorded_target_y[0:len(arg.recorded_target_x)], 'r-', label=f"Frame {i}")
        plt.plot(arg.recorded_target_x[len(arg.recorded_target_x) - 1],
                 arg.recorded_target_y[len(arg.recorded_target_y) - 1], 'ro', label=f"Frame {i}")

        plt.plot(arg.position_x[0:len(arg.position_x)], arg.position_y[0:len(arg.position_y)], 'b-',
                 label=f"Frame {i}")
        plt.plot(arg.position_x[len(arg.position_x) - 1], arg.position_y[len(arg.position_y) - 1], 'bd',
                 label=f"Frame {i}")

        midpoint = (
            (arg.position_x[len(arg.position_x) - 1] + arg.recorded_target_x[len(arg.recorded_target_x) - 1]) / 2,
            (arg.position_y[len(arg.position_y) - 1] + arg.recorded_target_y[len(arg.recorded_target_y) - 1]) / 2)
        distance = np.sqrt((arg.recorded_target_x[len(arg.recorded_target_x) - 1] - arg.position_x[
            len(arg.position_x) - 1]) ** 2 + (
                                   arg.recorded_target_y[len(arg.recorded_target_y) - 1] - arg.position_y[
                               len(arg.position_y) - 1]) ** 2)
        radius = distance / 2
        # Add a circle around the midpoint that encompasses both points
        if arg.success:
            circle = patches.Circle(midpoint, radius, edgecolor='g', facecolor='none', linestyle='--')
        else:
            circle = patches.Circle(midpoint, radius, edgecolor='r', facecolor='none', linestyle='--')

        plt.gca().add_patch(circle)  # Add circle to the current plot
        plt.text(midpoint[0], midpoint[1], str(round(arg.miss_distance)), ha='right', va='center', fontsize=12, color='black')

    plt.ioff()
    plt.show()


def find_time_range(*args):
    maxTime = -9999
    minTime = 9999
    dt = args[0].time[1] - args[0].time[0]
    for arg in args:
        currMaxTime = max(arg.time)
        currMinTime = min(arg.time)
        if currMaxTime > maxTime:
            maxTime = currMaxTime
        if currMinTime < minTime:
            minTime = currMinTime
    return minTime, maxTime, dt


def find_position_range(*args):
    maxX = -9999
    minX = 9999
    maxY = -9999
    minY = 9999
    for arg in args:
        currMaxX = max(arg.position_x)
        currMinX = min(arg.position_x)
        currMaxY = max(arg.position_y)
        currMinY = min(arg.position_y)

        targMaxX = max(arg.recorded_target_x)
        targMinX = min(arg.recorded_target_x)
        targMaxY = max(arg.recorded_target_y)
        targMinY = min(arg.recorded_target_y)

        currMaxX = max(currMaxX, targMaxX)
        currMinX = min(currMinX, targMinX)
        currMaxY = max(currMaxY, targMaxY)
        currMinY = min(currMinY, targMinY)

        if currMaxX > maxX:
            maxX = currMaxX
        if currMinX < minX:
            minX = currMinX
        if currMaxY > maxY:
            maxY = currMaxY
        if currMinY < minY:
            minY = currMinY
    return maxX, minX, maxY, minY


def find_optimal_angle(x_m, y_m, vx_m, vy_m, x_t, y_t, vx_t, vy_t, a_m, g, time, start_time):
    min_theta = 0
    max_theta = np.pi
    n = 5
    min_distance = float('inf')
    optimal_angle = -1
    tol = 10
    dt = time[1] - time[0]
    num_iter = 0

    while min_distance > tol and num_iter < 100:
        theta_array = np.linspace(min_theta, max_theta, n)
        curr_min_theta = -1
        curr_min_distance = float('inf')
        dTheta = theta_array[1] - theta_array[0]
        for theta in theta_array:
            x_m_curr = x_m
            y_m_curr = y_m
            vx_m_curr = vx_m
            vy_m_curr = vy_m
            ax_m = np.cos(theta) * a_m
            ay_m = np.sin(theta) * a_m
            x_t_curr = x_t
            y_t_curr = y_t
            vx_t_curr = vx_t
            vy_t_curr = vy_t
            ay_t = g
            for t in time:
                vy_t_curr += ay_t * dt

                x_t_curr += vx_t_curr * dt
                y_t_curr += vy_t_curr * dt

                if t > start_time:
                    vx_m_curr += ax_m*dt
                    vy_m_curr += ay_m*dt

                    x_m_curr += vx_m_curr*dt
                    y_m_curr += vy_m_curr*dt

                    distance = np.sqrt((x_m_curr - x_t_curr)**2 + (y_m_curr - y_t_curr)**2)

                    if distance < curr_min_distance:
                        curr_min_distance = distance
                        curr_min_theta = theta

        if curr_min_distance < min_distance:
            min_distance = curr_min_distance
            optimal_angle = curr_min_theta

        max_theta = curr_min_theta + dTheta
        min_theta = curr_min_theta - dTheta

        num_iter += 1

    return optimal_angle


def pronav(x_m, y_m, x_t, y_t, a_m):
    los_x = x_t - x_m
    los_y = y_t - y_m
    los_distance = np.sqrt(los_x ** 2 + los_y ** 2)

    los_unit_vector = np.array([los_x, los_y]) / los_distance

    ax_m = a_m * los_unit_vector[0]
    ay_m = a_m * los_unit_vector[1]

    return ax_m, ay_m

 # los_x = target.position_x[target_index[0]] - missile_x[timeInd - 1]
                # los_y = target.position_y[target_index[0]] - missile_y[timeInd - 1]
                # los_distance = np.sqrt(los_x ** 2 + los_y ** 2)
                #
                # los_unit_vector = np.array([los_x, los_y]) / los_distance
                #
                # ax_m = missile.acceleration * los_unit_vector[0]
                # ay_m = missile.acceleration * los_unit_vector[1]
# x_t = target.position_x[target_index[0]]
                # y_t = target.position_y[target_index[0]]
                # vx_t = target.velocity_x[target_index[0]]
                # vy_t = target.velocity_y[target_index[0]]
                #
                # y_m = missile_y[timeInd - 1]
                # x_m = missile_x[timeInd - 1]
                # vx_m = missile_vx[timeInd - 1]
                # vy_m = missile_vy[timeInd - 1]
                #
                # los_current = np.atan2(y_t - y_m, x_t - x_m)
                #
                # ay_t = ay  # Target acceleration in x and y directions
                # vx_t += 0
                # vy_t += ay_t * dt
                # x_t += vx_t * dt
                # y_t += vy_t * dt + 0.5 * ay_t * dt ** 2
                #
                # los_next = np.atan2(y_t - (y_m + vy_m * dt), x_t - (x_m + vx_m * dt))
                # los_rate = (los_next - los_current) / dt  # LOS rate in rad/s
                #
                # a_pn = NC * np.sqrt((x_t - x_m) ** 2 + (y_t - y_m) ** 2) * los_rate
                # # a_pn = NC * vx_m * los_rate
                # a_apn = a_pn + APN_bias
                #
                # a_apn = np.clip(a_apn, -missile.acceleration, missile.acceleration)
                #
                # ax_m = a_apn * np.cos(los_next)
                # ay_m = a_apn * np.sin(los_next)
                #
                # missile_vx.append(missile_vx[timeInd - 1] + (ax_m * dt))
                # missile_vy.append(missile_vy[timeInd - 1] + (ay * dt) + (ay_m * dt))
                #
                # missile_x.append(missile_x[timeInd - 1] + missile_vx[timeInd - 1] * dt)
                # missile_y.append(missile_y[timeInd - 1] + missile_vy[timeInd - 1] * dt)

